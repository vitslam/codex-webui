"""Map only native offered decisions to choices; the browser sends an index."""
import json
from .protocol import ProtocolError


def choices(method, params):
    if method=='item/permissions/requestApproval':
        permissions=params.get('permissions')
        if not isinstance(permissions,dict):raise ProtocolError('invalid_native_event')
        return [dict(label=label,response={'permissions':permissions if granted else {},'scope':scope})
                for label,scope,granted in [('approval.turn','turn',True),('approval.session','session',True),('approval.decline','turn',False)]]
    offered=params.get('availableDecisions')
    if offered is None:
        offered=['accept','acceptForSession','decline','cancel']
        if params.get('proposedExecpolicyAmendment'):offered.append({'acceptWithExecpolicyAmendment':{'execpolicy_amendment':params['proposedExecpolicyAmendment']}})
        offered.extend({'applyNetworkPolicyAmendment':{'network_policy_amendment':v}} for v in params.get('proposedNetworkPolicyAmendments') or [])
    if not isinstance(offered,list) or len(offered)>32:raise ProtocolError('invalid_native_event')
    result=[]
    for value in offered:
        if isinstance(value,str):
            label={'accept':'approval.allow_once','acceptForSession':'approval.session','decline':'approval.decline','cancel':'approval.cancel'}.get(value)
        elif isinstance(value,dict):
            label='approval.rule' if set(value)=={'acceptWithExecpolicyAmendment'} else 'approval.network_rule' if set(value)=={'applyNetworkPolicyAmendment'} else None
        else:label=None
        if label:result.append(dict(label=label,response={'decision':value},detail=json.dumps(value,ensure_ascii=False) if isinstance(value,dict) else ''))
    if not result:raise ProtocolError('invalid_native_event')
    return result
