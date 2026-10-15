import sqlite3, glob, os, json

base = os.path.expandvars(r'%APPDATA%\Trae CN')
for db in glob.glob(base + r'/**/state.vscdb', recursive=True):
    try:
        con = sqlite3.connect('file:' + db + '?mode=ro', uri=True)
        rows = con.execute("select key,value from ItemTable").fetchall()
        for k, v in rows:
            kl = str(k).lower()
            if any(x in kl for x in ['disabled', 'unhealthy', 'uninstalled', 'enabled', 'crashed', 'terminated']):
                print(os.path.basename(os.path.dirname(db)), '|', k, '|', str(v)[:500])
        con.close()
    except Exception as e:
        print('ERR', db, e)
