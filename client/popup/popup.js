const data = JSON.parse(new URLSearchParams(location.search).get("data"));
const $ = (id) => document.getElementById(id);

$("avatar").prepend(data.sharerName.slice(0, 1).toUpperCase());
$("headline").textContent = `${data.sharerName} is sharing`;
$("detail").textContent = data.room ? `${data.title} · ${data.room}` : data.title;

$("watch").onclick = () => sl.send("popup:watch", data.streamId);
$("dismiss").onclick = () => sl.send("popup:close");
