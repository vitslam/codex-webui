"""Typed outputs and authorized local Markdown attachments, independent of skills."""
from __future__ import annotations
import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import stat
from urllib.parse import unquote, urlsplit


def image_mime(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):return 'image/png'
    if raw.startswith(b'\xff\xd8\xff'):return 'image/jpeg'
    if raw.startswith(b'RIFF') and raw[8:12]==b'WEBP':return 'image/webp'
    if raw.startswith((b'GIF87a',b'GIF89a')):return 'image/gif'
    return None


def bounded(value, depth=0):
    """Keep useful tool records without serialized blobs or credentials."""
    if depth>7:return '[truncated]'
    if isinstance(value,str):
        if len(value)>512 and re.fullmatch(r'(?:data:[^,]+,)?[A-Za-z0-9+/=\s]+',value):return '[binary output stored separately]'
        return value[:12000]
    if isinstance(value,dict):
        if value.get('type') in ('image','imageGeneration','inputImage'):
            value={key:('[binary output stored separately]' if key in ('data','base64','result','url','image_url','imageUrl') and isinstance(child,str) else child) for key,child in value.items()}
        return {str(k)[:100]:bounded(v,depth+1) for k,v in list(value.items())[:60]
                if not re.search(r'(?i)(api.?key|access.?token|refresh.?token|authorization|password|secret|^env$)',str(k))}
    if isinstance(value,list):return [bounded(v,depth+1) for v in value[:40]]
    return value if value is None or isinstance(value,(int,float,bool)) else str(value)[:200]


class Outputs:
    references=re.compile(r'```[\s\S]*?(?:```|\Z)|`[^`\n]*`|(?P<label>!?\[[^\]\n]*\])\((?P<href><[^>\n]+>|[^)\n]+)\)')
    max_file,max_total,max_files=15*1024*1024,60*1024*1024,16

    def __init__(self,store,job,cwd,root,protected=()):
        self.store,self.job,self.cwd,self.root=store,job,Path(cwd).resolve(),Path(root).resolve()
        self.protected=[Path(p).resolve() for p in protected]
        self.saved={};self.total=0

    def save(self,raw,name,image=False):
        if not raw or len(raw)>self.max_file:raise ValueError('output_limit')
        digest=hashlib.sha256(raw).hexdigest()
        if digest in self.saved:return self.saved[digest]
        if len(self.saved)>=self.max_files or self.total+len(raw)>self.max_total:raise ValueError('output_limit')
        mime=image_mime(raw)
        if image and not mime:raise ValueError('invalid_image')
        name=Path(name).name[:255] or 'output'
        if any(ord(c)<32 for c in name):name='output'
        mime=mime or mimetypes.guess_type(name)[0] or 'application/octet-stream'
        result=self.store.save_artifact(self.job,digest,name,mime,raw)
        self.saved[digest]=result;self.total+=len(raw)
        self.store.report(self.job,{'artifacts':list(self.saved.values())})
        return result

    def read(self,path,trusted_image=False):
        path=Path(path).expanduser()
        if not path.is_absolute():path=self.cwd/path
        resolved=path.resolve()
        if not trusted_image and not any(resolved.is_relative_to(root) for root in (self.cwd,self.root)):raise ValueError('output_outside_workspace')
        if not resolved.is_relative_to(self.root) and not trusted_image and any(resolved==p or p.is_dir() and resolved.is_relative_to(p) for p in self.protected):raise ValueError('private_configuration')
        if resolved.name in ('auth.json','secrets.env') or resolved.name=='.env' or resolved.name.startswith('.env.'):raise ValueError('private_configuration')
        fd=os.open(resolved,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size>self.max_file:raise ValueError('invalid_output')
            return stream.read(self.max_file+1),resolved.name

    def rewrite(self,text):
        def replace(match):
            href=match.group('href')
            if href is None:return match[0]
            href=href.strip().strip('<>');parsed=urlsplit(href)
            if parsed.scheme not in ('','file','sandbox') or parsed.netloc not in ('','localhost') or not parsed.path or href.startswith(('#','/api/')):return match[0]
            try:
                raw,name=self.read(unquote(parsed.path));artifact=self.save(raw,name)
                url=artifact['url']+('' if match['label'].startswith('!') else '?download=1')
                if parsed.fragment:url+='#'+parsed.fragment
                return match['label']+'('+url+')'
            except (OSError,ValueError):return match[0]
        return self.references.sub(replace,text)

    def capture(self,item,complete):
        artifacts=[]
        def walk(value,depth=0):
            if depth>8 or len(artifacts)>=16:return
            if isinstance(value,list):
                for v in value[:40]:walk(v,depth+1)
            elif isinstance(value,dict):
                kind=value.get('type')
                if kind in ('image','imageGeneration','inputImage'):
                    encoded=value.get('data') or value.get('base64') or value.get('result') or value.get('url') or value.get('image_url') or value.get('imageUrl')
                    if isinstance(encoded,dict):encoded=encoded.get('url')
                    if isinstance(encoded,str):
                        if encoded.startswith('data:image/'):encoded=encoded.split(',',1)[-1]
                        if len(encoded)<=(self.max_file+2)//3*4:
                            try:
                                raw=base64.b64decode(encoded,validate=True)
                                artifacts.append(self.save(raw,'generated-'+hashlib.sha256(raw).hexdigest()[:12]+'.'+(image_mime(raw) or 'image/png').split('/')[-1],True));return
                            except ValueError:pass
                    path=value.get('savedPath')
                    if complete and isinstance(path,str):
                        try:
                            raw,name=self.read(path,True);artifacts.append(self.save(raw,name,True));return
                        except (OSError,ValueError):pass
                for key,child in list(value.items())[:60]:
                    if key not in ('result','data','base64','url','image_url') or isinstance(child,(list,dict)):walk(child,depth+1)
        if complete:walk(item)
        return list({a['url']:a for a in artifacts}.values())
