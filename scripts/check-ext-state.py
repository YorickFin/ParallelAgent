import sqlite3, glob, os, sys

base = os.path.expandvars(r'%APPDATA%\Trae CN')
for db in glob.glob(base + r'/**/state.vscdb', recursive=True):
    try:
        con = sqlite3.connect('file:' + db + '?mode=ro', uri=True)
        rows = con.execute("select key,value from ItemTable").fetchall()
        for k, v in rows:
            vs = str(v)
            if 'parallelagent' in vs.lower() or 'parallelagent' in str(k).lower():
                print(os.path.basename(os.path.dirname(db)), '|', k, '|', vs[:400])
        con.close()
    except Exception as e:
        print('ERR', db, e)
