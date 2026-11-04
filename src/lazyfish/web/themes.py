"""Publish validated palettes and metadata from the application theme registry."""
import json
import re


def theme_assets(base):
    registry = json.loads((base / 'themes.json').read_text(encoding='utf-8'))
    themes = registry['themes']
    ids, token_names = set(), None
    for theme in themes:
        identifier, tokens = theme['id'], theme['tokens']
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,63}', identifier) or identifier in ids or identifier == 'system':
            raise ValueError('Invalid or duplicate theme id')
        ids.add(identifier)
        if theme['scheme'] not in ('light', 'dark') or not isinstance(theme['enabled'], bool):
            raise ValueError('Invalid theme scheme or availability')
        if not theme.get('name') and not theme.get('labelKey'):
            raise ValueError('Theme needs a display name')
        if token_names is None:
            token_names = set(tokens)
        if set(tokens) != token_names or not {'bg', 'sidebar', 'surface', 'composer-border', 'user-bubble'} <= set(tokens):
            raise ValueError('Theme palettes must define the same complete token set')
        for name, value in tokens.items():
            if (not re.fullmatch(r'[a-z][a-z0-9-]*', name) or not isinstance(value, str) or
                    not value or any(char in value for char in '{};<>\r\n')):
                raise ValueError('Invalid theme token')
    active = {theme['id']: theme for theme in themes if theme['enabled']}
    if registry['default'] not in active or registry['system'].keys() != {'light', 'dark'}:
        raise ValueError('Theme defaults must reference enabled themes')
    for scheme, identifier in registry['system'].items():
        if identifier not in active or active[identifier]['scheme'] != scheme:
            raise ValueError('System theme mapping has the wrong color scheme')
    styles, metadata = [], []
    for identifier, theme in active.items():
        selector = ':root[data-theme="' + identifier + '"]'
        if identifier == registry['default']:
            selector = ':root, ' + selector
        declarations = ['  color-scheme: ' + theme['scheme'] + ';']
        declarations.extend('  --' + name + ': ' + value + ';' for name, value in theme['tokens'].items())
        styles.append(selector + ' {\n' + '\n'.join(declarations) + '\n}')
        metadata.append({key: value for key, value in theme.items() if key in ('id', 'name', 'labelKey', 'scheme')})
        metadata[-1]['color'] = theme['tokens']['bg']
    manifest = dict(default=registry['default'], system=registry['system'], themes=metadata)
    # Metadata and the small bootstrap travel together, applying saved appearance
    # before first paint without waiting for the app or language catalogs.
    script = ('\'use strict\';\nwindow.LazyfishThemeRegistry = ' + json.dumps(manifest, ensure_ascii=True) + ';\n').encode()
    script += (base / 'static/themes.js').read_bytes()
    return {'themes.css': ('\n'.join(styles) + '\n').encode(), 'themes.js': script}
