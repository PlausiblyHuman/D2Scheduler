r"""D2 - New Pool escapes the string values it interpolates into JSON bodies (2026-10-13).

The create actions post a JSON template string through "Send an HTTP request to SharePoint". A value
holding a double quote or a backslash broke that JSON: a Fiberglass task titled
'Overdig requirements (shell width plus working space, typically 12-18" per side)' made Create_task
return 400 and the pool was left one task short.

- Six interpolated string values are wrapped so backslashes are doubled first and double quotes are
  then escaped: replace(replace(<expr>, '\', '\\'), '"', '\"'). In Workflow Definition Language a
  single-quoted literal has no backslash escaping, so '\' is one backslash and '\\' is two.
  Create_job: Title, Address, City. Create_assignment: Title, SubPhaseName. Create_task: Title.
  Dates, numbers and the PM id are left as they were.
- Compose_failure_message no longer names currentSubphase as where the build stopped. The loop carries
  on after a failed iteration, so that variable holds the last sub-phase processed, not the one that failed.
"""
BS = "'" + chr(92) + "'"                      # '\'   one backslash
DBS = "'" + chr(92) * 2 + "'"                 # '\\'  two backslashes
QT = "'" + '"' + "'"                          # '"'
QE = "'" + chr(92) + '"' + "'"                # '\"'  backslash, quote


def esc(expr):
    return 'replace(replace(' + expr + ', ' + BS + ', ' + DBS + '), ' + QT + ', ' + QE + ')'


def sub(body, old, new):
    assert body.count(old) == 1, (body.count(old), old)
    return body.replace(old, new)


MSG_OLD = " was interrupted while creating sub-phase ', variables('currentSubphase'), '. A Job row and a partial set of Assignments/Tasks now exist in production."
MSG_NEW = " could not create every row. The last sub-phase processed was ', variables('currentSubphase'), ', but the gap may be earlier. A Job row and a partial set of Assignments/Tasks now exist in production."


def find(actions, name):
    for k, a in actions.items():
        if k == name:
            return a
        for s in (a.get('actions', {}), a.get('else', {}).get('actions', {})):
            hit = find(s, name)
            if hit:
                return hit
    return None


def apply(actions):
    task = find(actions, 'Create_task')['inputs']['parameters']
    if 'replace(replace(' in task['parameters/body']:
        return actions
    # Create_job: Title, Address, City
    p = find(actions, 'Create_job')['inputs']['parameters']; b = p['parameters/body']
    for old in ("triggerOutputs()?['body/Title']", "coalesce(triggerOutputs()?['body/Address'], '')", "coalesce(triggerOutputs()?['body/City'], '')"):
        b = sub(b, '@{' + old + '}', '@{' + esc(old) + '}')
    p['parameters/body'] = b
    # Create_assignment: Title is the whole concat (its separator glyph is left untouched), then SubPhaseName
    p = find(actions, 'Create_assignment')['inputs']['parameters']; b = p['parameters/body']
    head, tail = '"Title":"@{concat(', ')}","JobId"'
    assert b.count(head) == 1 and b.count(tail) == 1
    i = b.index(head) + len('"Title":"@{'); j = b.index(tail) + 1
    b = b[:i] + esc(b[i:j]) + b[j:]
    sp = "items('Apply_to_each_subphase')?['Title']"
    b = sub(b, '"SubPhaseName":"@{' + sp + '}"', '"SubPhaseName":"@{' + esc(sp) + '}"')
    p['parameters/body'] = b
    # Create_task: Title
    t = "items('Apply_to_each_task')?['Title']"
    task['parameters/body'] = sub(task['parameters/body'], '@{' + t + '}', '@{' + esc(t) + '}')
    msg = find(actions, 'Compose_failure_message')
    msg['inputs'] = sub(msg['inputs'], MSG_OLD, MSG_NEW)
    return actions
