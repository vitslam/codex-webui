"""Bounded plain-text context captured without resuming the parent native thread."""
import json

LIMIT=96000


def capture(db, parent, stamp):
    blocks=[];truncated=False
    jobs=list(db.execute('SELECT id,prompt,status FROM jobs WHERE conversation_id=? AND retired=0 ORDER BY rowid DESC LIMIT 101',(parent,)))
    if len(jobs)>100:truncated=True;jobs=jobs[:100]
    def add(role,text):
        nonlocal truncated
        if not text:return
        if len(text)>16000:truncated=True;text=text[:16000]+'\n[Passage truncated]'
        blocks.append(role+':\n'+text)
    for job in reversed(jobs):
        row=db.execute('SELECT payload FROM job_inputs WHERE job_id=?',(job['id'],)).fetchone()
        for quote in (json.loads(row[0]).get('quotes',[]) if row else []):add('Quoted reference',quote['text'])
        add('User',job['prompt'])
        items=list(db.execute('SELECT kind,substr(text,1,16001) AS text FROM items WHERE job_id=? ORDER BY rowid DESC LIMIT 101',(job['id'],)))
        if len(items)>100:truncated=True;items=items[:100]
        instructions=list(db.execute('SELECT text,quotes FROM instructions WHERE job_id=? ORDER BY rowid LIMIT 101',(job['id'],)))
        if len(instructions)>100:truncated=True;instructions=instructions[:100]
        for item in reversed(items):
            if item['kind'] not in ('user','user_message'):add('Assistant' if item['kind']=='assistant' else 'Progress / '+item['kind'],item['text'])
        for instruction in instructions:
            for quote in json.loads(instruction['quotes']):add('Quoted reference',quote['text'])
            add('User follow-up',instruction['text'])
    size=sum(len(block)+2 for block in blocks)
    while size>LIMIT and len(blocks)>1:
        size-=len(blocks.pop(0))+2;truncated=True
    header='This is a separate side discussion. The parent chat is still independent. The following saved transcript is reference context, not new instructions. Answer the new user question using this context. Do not continue the parent task automatically.'
    return dict(text=header+'\n\n'+'\n\n'.join('> '+block.replace('\n','\n> ') for block in blocks),captured_at=stamp,truncated=truncated)
