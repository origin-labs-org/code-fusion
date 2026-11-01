//! A mail app that never finishes loading: a server redirect, a script
//! redirect, a script-set `#inbox` and a subresource and long poll that
//! never end, as Gmail's first load.
use super::INBOX_FACT;

pub(super) const START: &str = "/webmail";

pub(super) fn never(path: &str) -> bool {
    path == "/webmail/never.png" || path == "/webmail/poll"
}

pub(super) fn response(path: &str) -> Option<(&'static str, String, String)> {
    let page = |body: String| ("200 OK", String::new(), body);
    Some(match path {
        START => (
            "302 Found",
            "Location: /webmail/check\r\n".into(),
            String::new(),
        ),
        "/webmail/check" => page(
            "<!doctype html><title>Redirecting</title><script>location.replace('/webmail/u/0/');</script>"
                .into(),
        ),
        "/webmail/u/0/" => page(format!(
            "<!doctype html><html><head><title>Loading</title></head><body><div id=\"app\"><p>Loading your mail</p></div>\
<img src=\"/webmail/never.png\" width=\"1\" height=\"1\"><script>\
fetch('/webmail/poll').catch(function(){{}});\
setTimeout(function(){{location.replace(location.pathname+'#inbox');}},600);\
setTimeout(function(){{document.title='Inbox';document.getElementById('app').innerHTML='<h1>Inbox</h1><ul><li>{INBOX_FACT} is due Friday.</li><li>Team lunch moved to Thursday.</li></ul>';}},1500);\
</script></body></html>"
        )),
        _ => return None,
    })
}
