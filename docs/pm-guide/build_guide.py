import base64, io, os, re
SP = os.path.dirname(os.path.abspath(__file__))

def b64(name):
    with open(os.path.join(SP, name), "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("ascii")

imgs = {
    "IMG_HOME":     b64("shot-home.jpeg"),
    "IMG_TODAY":    b64("shot-today.jpeg"),
    "IMG_OVERDUE":  b64("shot-overdue.jpeg"),
    "IMG_NEWPOOL":  b64("shot-newpool.jpeg"),
    "IMG_CALENDAR": b64("shot-calendar.jpeg"),
    "IMG_JOBS":     b64("shot-jobs.jpeg"),
    "IMG_COMMIT":   b64("shot-commit.jpeg"),
}
email = io.open(os.path.join(SP, "daily-summary-live.html"), encoding="utf-8").read()

tpl = io.open(os.path.join(SP, "guide.tpl.html"), encoding="utf-8").read()
out = tpl
for k, v in imgs.items():
    out = out.replace("{{" + k + "}}", v)
out = out.replace("<!--EMAIL_BODY-->", email)

missing = re.findall(r"\{\{[A-Z_]+\}\}", out)
assert not missing, f"unreplaced placeholders: {set(missing)}"
io.open(os.path.join(SP, "d2-guide.html"), "w", encoding="utf-8").write(out)
print(f"wrote d2-guide.html  {len(out)/1024:.0f} KB")
