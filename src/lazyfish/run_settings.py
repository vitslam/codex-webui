"""Validated conversation choices, shared by saves and turn submission."""
import re
from .storage import StoreError


def validate(value):
    if not isinstance(value,dict) or set(value)-{'model','effort','fast_mode','permission_mode','collaboration_mode'}:
        raise StoreError('invalid_run_settings')
    for key,item in value.items():
        valid = (item is None or isinstance(item,str) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}',item))) if key=='model' else (
            item in (None,'none','minimal','low','medium','high','xhigh','max','ultra') if key=='effort' else
            type(item) is bool if key=='fast_mode' else
            item in (None,'ask','auto_review','full_access','read_only','custom') if key=='permission_mode' else item in ('default','plan'))
        if not valid:raise StoreError('invalid_run_settings')
    return dict(value)
