"""Content-versioned public code assets; authenticated data never enters this cache."""
import hashlib
import re
from importlib.resources import files
from .themes import theme_assets


def assets():
    package=files("lazyfish.web")
    values={p.name:p.read_bytes() for p in package.joinpath("static").iterdir() if p.name.endswith((".js",".css"))}
    values.update(theme_assets(package))
    versions={name:hashlib.sha256(body).hexdigest()[:20] for name,body in values.items()}
    html=package.joinpath("static","index.html").read_text()
    html=re.sub(r'((?:src|href)="/)([^"/?]+)(\")',
                lambda m:m[1]+m[2]+("?v="+versions[m[2]] if m[2] in versions else "")+m[3],html)
    return values,versions,html.encode()
