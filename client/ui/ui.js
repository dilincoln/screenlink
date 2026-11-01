const $ = (id) => document.getElementById(id);

/** Tiny element builder: h("div", { class: "x", onclick }, "text", child). Never parses HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "style") el.style.cssText = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const CODEC_LABEL = { h264: "H.264", av1: "AV1", vp9: "VP9", vp8: "VP8" };
const RES_LABEL = { native: "Nativa", 2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p", 480: "480p" };

function hue(id) {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return n % 360;
}

function avatar(user, { presence, small } = {}) {
  return h(
    "span",
    { class: `avatar${small ? " small" : ""}`, style: `background: hsl(${hue(user.id)} 55% 48%)` },
    (user.name ?? "?").slice(0, 1).toUpperCase(),
    presence === undefined ? null : h("i", { class: `presence${presence ? " on" : ""}` }),
  );
}

function spec(settings) {
  const res = settings.height ? `${settings.height}p` : "nativa";
  const audio = settings.audio ? " · 🔊 áudio" : "";
  return `${res} · ${settings.fps} fps · ${(settings.bitrate / 1e6).toFixed(0)} Mbps · ${CODEC_LABEL[settings.codec] ?? settings.codec}${audio}`;
}

let toastTimer = null;
function toast(text, error = false) {
  const el = $("toast");
  el.textContent = text;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

async function act(fn, success) {
  try {
    const value = await fn();
    if (success) toast(success);
    return value;
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- state ----------

let state = null;
let selectedRoomId = null;
let shownAuthError = false;
const ADMIN_VIEW = "admin";
try {
  selectedRoomId = localStorage.getItem("room");
} catch {}

function selectRoom(id) {
  selectedRoomId = id;
  try {
    localStorage.setItem("room", id);
  } catch {}
  render();
}

function render() {
  if (!state) return;
  $("onboarding").hidden = state.registered;
  $("app").hidden = !state.registered;
  if (!state.registered) {
    const form = $("register-form");
    if (!form.serverUrl.value) {
      form.serverUrl.value = state.serverUrl;
      checkServer();
    }
    if (state.authError && !shownAuthError) {
      shownAuthError = true;
      $("register-error").textContent = state.authError.message;
      $("register-error").hidden = false;
      if (state.authError.code === "password_required") $("password-field").hidden = false;
    }
    stopAdminPolling();
    return;
  }
  shownAuthError = false;

  $("conn").className = `conn ${state.connection}`;
  $("mute-btn").classList.toggle("muted", state.mute.muted);
  $("mute-btn").title = muteText(state.mute);
  if ($("mute-dialog").open) renderMuteStatus();
  $("theme-btn").classList.toggle("light", !state.dark);
  $("theme-btn").title = state.dark ? "Mudar para o tema claro" : "Mudar para o tema escuro";
  $("update-btn").hidden = !state.update;
  if (state.update) $("update-btn").textContent = `Atualização disponível: ${state.update.version}`;
  $("conn").title = { online: "Conectado", connecting: "Conectando…", offline: "Offline — tentando de novo" }[state.connection];
  if (state.user) {
    $("me-avatar").replaceWith(Object.assign(avatar(state.user, { small: true }), { id: "me-avatar" }));
    $("me-name").textContent = state.user.name;
  }

  if (selectedRoomId === ADMIN_VIEW && !state.isAdmin) selectedRoomId = null;
  if (selectedRoomId !== ADMIN_VIEW && !state.rooms.some((r) => r.id === selectedRoomId)) selectedRoomId = state.rooms[0]?.id ?? null;
  $("admin-btn").hidden = !state.isAdmin;
  $("admin-btn").classList.toggle("on", selectedRoomId === ADMIN_VIEW);
  renderRoomList();
  if (selectedRoomId === ADMIN_VIEW) {
    startAdminPolling();
    return;
  }
  stopAdminPolling();
  renderContent();
}

function liveIn(roomId) {
  return state.streams.filter((s) => s.roomId === roomId);
}

function renderRoomList() {
  $("room-list").replaceChildren(
    ...state.rooms.map((room) => {
      const live = liveIn(room.id).length;
      return h(
        "button",
        { class: `room-item${room.id === selectedRoomId ? " on" : ""}`, onclick: () => selectRoom(room.id) },
        h("span", { class: "room-icon" }, room.name.slice(0, 2).toUpperCase()),
        h("span", { class: "ellipsis" }, room.name),
        live ? h("span", { class: "live-badge" }, String(live)) : h("span", { class: "count" }, String(room.members.length)),
      );
    }),
  );
}

function renderContent() {
  const content = $("content");
  const room = state.rooms.find((r) => r.id === selectedRoomId);
  if (!room) {
    content.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("h2", {}, "Nenhuma sala ainda"),
        h("p", {}, "Crie uma sala e mande o código de convite para seus amigos, ou entre em uma com um código que você recebeu."),
        h(
          "div",
          { class: "row" },
          h("button", { class: "primary", onclick: () => openDialog("new-room-dialog") }, "Nova sala"),
          h("button", { onclick: () => openDialog("join-room-dialog") }, "Entrar com código"),
        ),
      ),
    );
    return;
  }

  const isOwner = room.ownerId === state.user?.id;
  const onlineSet = new Set(state.online);
  if (state.connection === "online" && state.user) onlineSet.add(state.user.id);
  const onlineCount = room.members.filter((m) => onlineSet.has(m.id)).length;
  const streams = liveIn(room.id);
  const mine = state.sharing;

  const head = h(
    "div",
    { class: "room-head" },
    h("div", {}, h("h1", {}, room.name), h("div", { class: "meta" }, `${room.members.length} ${room.members.length === 1 ? "membro" : "membros"} · ${onlineCount} online`)),
    h(
      "div",
      { class: "tools" },
      h(
        "div",
        { class: "invite", title: "Qualquer pessoa com este código pode entrar na sala" },
        h("span", { class: "label" }, "Código de convite"),
        h("span", { class: "mono" }, room.inviteCode),
        h("button", { class: "ghost", onclick: () => act(() => sl.invoke("clipboard:write", room.inviteCode), "Código de convite copiado") }, "Copiar"),
        isOwner
          ? h("button", { class: "ghost", title: "O código antigo para de funcionar", onclick: () => act(() => sl.invoke("rooms:code", room.id), "Novo código de convite criado") }, "Novo código")
          : null,
      ),
      isOwner
        ? h("button", { class: "danger", onclick: () => confirmThen(`Excluir “${room.name}” para todo mundo?`, () => sl.invoke("rooms:delete", room.id)) }, "Excluir sala")
        : h("button", { class: "danger", onclick: () => confirmThen(`Sair de “${room.name}”?`, () => sl.invoke("rooms:leave", room.id)) }, "Sair"),
    ),
  );

  const cta =
    mine?.roomId === room.id
      ? null
      : h(
          "div",
          { class: "share-cta" },
          h(
            "div",
            {},
            h("strong", {}, "Compartilhar sua tela"),
            h("p", {}, mine ? "Você está compartilhando em outra sala — começar aqui encerra aquela." : `Todo mundo online em ${room.name} recebe um popup e pode assistir.`),
          ),
          h("button", { class: "primary", disabled: state.connection !== "online", onclick: () => openShare(room) }, "Compartilhar tela"),
        );

  const live = h(
    "section",
    {},
    h("h3", {}, "Ao vivo agora"),
    streams.length
      ? h("div", { class: "streams", style: "margin-top: 12px" }, streams.map((s) => streamCard(s, room)))
      : h("p", { class: "muted" }, "Ninguém está compartilhando agora."),
  );

  const members = h(
    "section",
    {},
    h("h3", {}, "Membros"),
    h(
      "div",
      { class: "members", style: "margin-top: 8px" },
      room.members.map((m) => {
        const sharing = streams.some((s) => s.sharerId === m.id);
        const on = onlineSet.has(m.id);
        return h(
          "div",
          { class: "member" },
          avatar(m, { presence: on }),
          h(
            "div",
            {},
            h("div", {}, m.name, m.id === state.user?.id ? h("span", { class: "muted" }, " (você)") : null),
            h("div", { class: "status" }, sharing ? "compartilhando" : on ? "online" : "offline"),
          ),
          m.role === "owner" ? h("span", { class: "role" }, "dono") : null,
          isOwner && m.id !== state.user?.id
            ? h("button", { class: "ghost danger", onclick: () => confirmThen(`Remover ${m.name} da sala?`, () => sl.invoke("rooms:kick", room.id, m.id)) }, "Remover")
            : null,
        );
      }),
    ),
  );

  content.replaceChildren(head, ...(cta ? [cta] : []), live, members);
}

function streamCard(s, room) {
  const isMine = s.sharerId === state.user?.id;
  const member = room.members.find((m) => m.id === s.sharerId) ?? { id: s.sharerId, name: s.sharerName };
  if (isMine && state.sharing?.streamId === s.id) {
    const audience = state.sharing.audience ?? [];
    const names = new Map(audience.map((v) => [v.id, v.name]));
    return h(
      "div",
      { class: "stream-card mine" },
      h("div", { class: "top" }, avatar(member), h("div", { class: "who" }, h("div", { class: "name ellipsis" }, `Você — ${s.title}`), h("div", { class: "spec" }, spec(s.settings)))),
      h("div", { class: "encoder", id: "encoder" }, encoderInfo(state.sharing.encoder)),
      audience.length
        ? h(
            "div",
            { class: "tree" },
            audience.map((v) =>
              h("div", {}, "• ", v.name, h("span", { class: "via" }, v.depth <= 1 ? "direto" : `via ${names.get(v.parentId) ?? "relay"} (salto ${v.depth})`)),
            ),
          )
        : null,
      h(
        "div",
        { class: "bottom" },
        h("span", { class: "viewers" }, `${audience.length} assistindo`),
        h("button", { class: "danger", onclick: () => act(() => sl.invoke("share:stop")) }, "Parar de compartilhar"),
      ),
    );
  }
  const watching = state.watching.includes(s.id);
  return h(
    "div",
    { class: "stream-card" },
    h("div", { class: "top" }, avatar(member), h("div", { class: "who" }, h("div", { class: "name ellipsis" }, `${s.sharerName} — ${s.title}`), h("div", { class: "spec" }, spec(s.settings)))),
    h(
      "div",
      { class: "bottom" },
      h("span", { class: "viewers" }, `${s.viewers} assistindo`),
      isMine
        ? h("span", { class: "muted" }, "você")
        : h("button", { class: watching ? "" : "primary", onclick: () => sl.invoke("stream:watch", s.id) }, watching ? "Abrir" : "Assistir"),
    ),
  );
}

const LIMIT_LABEL = { cpu: "CPU", bandwidth: "banda", other: "outro motivo" };

function encoderInfo(e) {
  if (!e) return h("span", {}, "Aguardando o primeiro espectador…");
  const hw = e.powerEfficient === true || /vaapi|nvenc|mediafoundation|videotoolbox|external|hardware/i.test(e.encoder ?? "");
  return [
    h("span", {}, "Encoder ", h("b", {}, e.encoder ?? "?"), " ", hw ? "(hardware)" : h("span", { class: "warn" }, "(software)")),
    h("span", {}, `${e.codec ?? "?"} · ${e.width}×${e.height} · ${e.fps} fps · ${e.encodeMs.toFixed(1)} ms/quadro · ${e.direct} ${e.direct === 1 ? "direto" : "diretos"}`),
    e.limitedBy !== "none" ? h("span", { class: "warn" }, `Qualidade limitada por ${LIMIT_LABEL[e.limitedBy] ?? e.limitedBy}`) : null,
  ];
}

sl.on("encoder", (encoder) => {
  if (state?.sharing) state.sharing.encoder = encoder;
  const el = $("encoder");
  if (el) el.replaceChildren(...[encoderInfo(encoder)].flat().filter(Boolean));
});

sl.on("state", (next) => {
  state = next;
  render();
});

// ---------- dialogs ----------

function openDialog(id) {
  const dialog = $(id);
  dialog.querySelector("form").reset();
  setError(dialog, null);
  dialog.showModal();
  return dialog;
}

function setError(dialog, message) {
  const el = dialog.querySelector(".error");
  el.textContent = message ?? "";
  el.hidden = !message;
}

/** Wires a dialog form: Cancel closes it; OK runs `fn` and closes only if it succeeds. */
function dialogForm(id, fn) {
  const dialog = $(id);
  const form = dialog.querySelector("form");
  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const buttons = form.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn(form);
      dialog.close();
    } catch (err) {
      setError(dialog, err.message);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}

async function confirmThen(question, fn) {
  if (confirm(question)) await act(fn);
}

$("new-room-btn").onclick = () => openDialog("new-room-dialog");
$("join-room-btn").onclick = () => openDialog("join-room-dialog");

dialogForm("new-room-dialog", async (form) => {
  const { id } = await sl.invoke("rooms:create", form.name.value);
  selectedRoomId = id;
});

dialogForm("join-room-dialog", async (form) => {
  const { id } = await sl.invoke("rooms:join", form.code.value);
  selectedRoomId = id;
  toast("Você entrou na sala");
});

// Shows the password field only when the server asks for one.
async function checkServer() {
  const url = $("register-form").serverUrl.value;
  try {
    const info = await sl.invoke("server:info", url);
    $("password-field").hidden = !info.passwordRequired;
  } catch {
    $("password-field").hidden = true;
  }
}
$("register-form").serverUrl.addEventListener("change", checkServer);

$("register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const error = $("register-error");
  error.hidden = true;
  try {
    await sl.invoke("auth:signin", { serverUrl: form.serverUrl.value, name: form.name.value.trim(), password: form.password.value });
    form.password.value = "";
  } catch (err) {
    error.textContent = err.message === "fetch failed" ? "Não foi possível contactar o servidor." : err.message;
    error.hidden = false;
    if (/senha/.test(err.message)) $("password-field").hidden = false;
  }
});

// F12: this device's fingerprint (what ADMIN_FINGERPRINT and bans refer to).
document.addEventListener("keydown", (event) => {
  if (event.key !== "F12") return;
  event.preventDefault();
  const dialog = $("device-dialog");
  if (dialog.open) return dialog.close();
  $("fingerprint").textContent = state?.fingerprint ?? "…";
  dialog.showModal();
});
$("copy-fingerprint").onclick = () => act(() => sl.invoke("clipboard:write", state.fingerprint), "Impressão digital copiada");

// Settings
$("me-btn").onclick = () => {
  const dialog = openDialog("settings-dialog");
  const form = dialog.querySelector("form");
  form.name.value = state.user?.name ?? "";
  form.relayCapacity.value = String(state.settings.relayCapacity);
  const popupOption = form.notifications.querySelector('option[value="popup"]');
  popupOption.disabled = !state.popupPlaceable;
  popupOption.textContent = state.popupPlaceable ? "Mostrar um popup do ScreenLink" : "Mostrar um popup do ScreenLink (não no Wayland)";
  form.notifications.value = state.popupPlaceable || state.settings.notifications !== "popup" ? state.settings.notifications : "native";
  form.soundVolume.value = String(state.settings.soundVolume);
  updateVolume();
  form.autostart.checked = state.settings.autostart;
  form.theme.value = state.settings.theme;
  form.serverUrl.value = state.serverUrl;
};

dialogForm("settings-dialog", async (form) => {
  if (form.serverUrl.value.replace(/\/+$/, "") !== state.serverUrl && !confirm("Trocar o servidor desconecta você. Continuar?")) {
    throw new Error("Servidor não alterado.");
  }
  if (state.user && form.name.value.trim() !== state.user.name) await sl.invoke("me:rename", form.name.value);
  await sl.invoke("settings:set", {
    relayCapacity: Number(form.relayCapacity.value),
    notifications: form.notifications.value,
    soundVolume: Number(form.soundVolume.value),
    autostart: form.autostart.checked,
    theme: form.theme.value,
    serverUrl: form.serverUrl.value,
  });
});

function updateVolume() {
  const v = Number($("settings-form").soundVolume.value);
  $("volume-out").textContent = v ? `${v}%` : "mudo";
}
$("settings-form").soundVolume.addEventListener("input", updateVolume);
$("test-sound").onclick = () => sl.invoke("sound:test", $("settings-form").soundVolume.value);

$("logout-btn").onclick = async () => {
  if (!confirm("Sair? Entrar de novo por este dispositivo traz a mesma conta de volta.")) return;
  await act(() => sl.invoke("auth:logout"));
  $("settings-dialog").close();
};

// ---------- mute ----------

const DAYS = [["Seg", 1], ["Ter", 2], ["Qua", 3], ["Qui", 4], ["Sex", 5], ["Sáb", 6], ["Dom", 0]];
const PRESETS = [[15, "15 min"], [30, "30 min"], [60, "1 hora"], [120, "2 horas"], [240, "4 horas"], [480, "8 horas"]];

function clock(ts) {
  const date = new Date(ts);
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString("pt-BR", { weekday: "short" })} ${time}`;
}

function muteText(mute) {
  if (mute.manual === "forever") return "Notificações silenciadas até você reativar";
  if (mute.manual) return `Notificações silenciadas até ${clock(mute.manual)}`;
  if (mute.quietUntil) return `Horário silencioso — notificações silenciadas até ${clock(mute.quietUntil)}`;
  return "Notificações ativadas";
}

function renderMuteStatus() {
  $("mute-status").textContent = muteText(state.mute);
  $("mute-off").hidden = !state.mute.manual;
}

let quietDays = new Set();

function renderQuietDays() {
  $("quiet-days").replaceChildren(
    ...DAYS.map(([label, day]) =>
      h(
        "button",
        {
          type: "button",
          class: `chip${quietDays.has(day) ? " on" : ""}`,
          onclick: () => {
            if (quietDays.has(day)) quietDays.delete(day);
            else quietDays.add(day);
            renderQuietDays();
          },
        },
        label,
      ),
    ),
  );
}

function syncQuietEnabled() {
  $("quiet-fields").classList.toggle("disabled", !$("mute-form").quietEnabled.checked);
}

$("theme-btn").onclick = () => sl.invoke("settings:set", { theme: state.dark ? "light" : "dark" });

$("update-btn").onclick = () => sl.invoke("update:open");

$("mute-btn").onclick = () => {
  const dialog = openDialog("mute-dialog");
  const form = $("mute-form");
  const q = state.settings.quietHours;
  form.quietEnabled.checked = q.enabled;
  form.quietStart.value = q.start;
  form.quietEnd.value = q.end;
  quietDays = new Set(q.days);
  renderQuietDays();
  syncQuietEnabled();
  renderMuteStatus();
  return dialog;
};
$("mute-form").quietEnabled.addEventListener("change", syncQuietEnabled);

$("mute-presets").replaceChildren(
  ...PRESETS.map(([min, label]) => h("button", { type: "button", class: "chip", onclick: () => act(() => sl.invoke("mute:set", min)) }, label)),
);
$("mute-custom").onclick = () => {
  const form = $("mute-form");
  act(() => sl.invoke("mute:set", Number(form.amount.value) * Number(form.unit.value)));
};
$("mute-forever").onclick = () => act(() => sl.invoke("mute:set", "forever"));
$("mute-off").onclick = () => act(() => sl.invoke("mute:set", null));

dialogForm("mute-dialog", async (form) => {
  if (form.quietEnabled.checked && !quietDays.size) throw new Error("Escolha pelo menos um dia.");
  await sl.invoke("quiet:set", {
    enabled: form.quietEnabled.checked,
    days: [...quietDays],
    start: form.quietStart.value,
    end: form.quietEnd.value,
  });
  toast("Horário silencioso salvo");
});

// ---------- admin ----------
// Server-wide view for ADMIN_FINGERPRINT devices: who uses the server, which rooms exist, bans.
// The server leaves out invite codes and stream titles, so it gives no way into other rooms.

$("admin-btn").onclick = () => selectRoom(ADMIN_VIEW);

let adminTimer = null;
let adminData = null;

function startAdminPolling() {
  if (adminTimer) {
    if (adminData) renderAdmin();
    return;
  }
  const tick = async () => {
    try {
      adminData = await sl.invoke("admin:overview");
      if (selectedRoomId === ADMIN_VIEW) renderAdmin();
    } catch (err) {
      toast(err.message, true);
    }
  };
  tick();
  adminTimer = setInterval(tick, 5000);
}

function stopAdminPolling() {
  clearInterval(adminTimer);
  adminTimer = null;
}

async function refreshAdmin() {
  adminData = await sl.invoke("admin:overview");
  renderAdmin();
}

function ago(ts) {
  if (!ts) return "nunca";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "agora mesmo";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

/** Fills the ban form below so the admin can add a reason and confirm there. */
function banUser(fingerprint) {
  $("ban-fp").value = fingerprint;
  $("ban-reason").scrollIntoView({ behavior: "smooth", block: "center" });
  $("ban-reason").focus();
}

function renderAdmin() {
  const content = $("content");
  // Keep what is being typed in the ban form across the 5 s refresh.
  const typed = { fp: $("ban-fp")?.value ?? "", reason: $("ban-reason")?.value ?? "", focus: document.activeElement?.id };
  if (!adminData) {
    content.replaceChildren(h("p", { class: "muted" }, "Carregando…"));
    return;
  }
  const { users, rooms, bans, stats } = adminData;
  const tile = (n, k) => h("div", { class: "tile" }, h("div", { class: "n" }, String(n)), h("div", { class: "k" }, k));

  const usersTable = h(
    "table",
    { class: "table" },
    h("thead", {}, h("tr", {}, ["Usuário", "Impressão digital", "Salas", "Visto por último", "Status", ""].map((t) => h("th", {}, t)))),
    h(
      "tbody",
      {},
      users.map((u) =>
        h(
          "tr",
          {},
          h("td", {}, h("div", { class: "who" }, avatar(u, { small: true, presence: u.online }), u.name, u.id === state.user?.id ? h("span", { class: "muted" }, "(você)") : null)),
          h("td", { class: "mono", title: u.fingerprint }, u.fingerprint),
          h("td", {}, String(u.rooms)),
          h("td", {}, u.online ? "online agora" : ago(u.lastSeen)),
          h("td", {}, u.admin ? h("span", { class: "pill admin" }, "admin") : u.banned ? h("span", { class: "pill bad" }, "banido") : h("span", { class: `pill${u.online ? " ok" : ""}` }, u.online ? "online" : "offline")),
          h(
            "td",
            { class: "actions" },
            u.admin
              ? null
              : u.banned
                ? h("button", { class: "ghost", onclick: () => act(() => sl.invoke("admin:unban", u.fingerprint).then(refreshAdmin), `${u.name} foi desbanido`) }, "Desbanir")
                : h("button", { class: "ghost danger", onclick: () => banUser(u.fingerprint) }, "Banir"),
          ),
        ),
      ),
    ),
  );

  const roomsTable = rooms.length
    ? h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, ["Sala", "Dono", "Membros", "Ao vivo", "Criada", ""].map((t) => h("th", {}, t)))),
        h(
          "tbody",
          {},
          rooms.map((r) =>
            h(
              "tr",
              {},
              h("td", {}, r.name),
              h("td", {}, r.ownerName),
              h("td", {}, String(r.members)),
              h("td", {}, r.live.length ? r.live.map((l) => `${l.sharerName} → ${l.viewers}`).join(", ") : h("span", { class: "muted" }, "—")),
              h("td", {}, ago(r.createdAt)),
              h(
                "td",
                { class: "actions" },
                h("button", { class: "ghost danger", onclick: () => confirmThen(`Excluir “${r.name}” para todos os ${r.members} membros?`, () => sl.invoke("admin:deleteRoom", r.id).then(refreshAdmin)) }, "Excluir"),
              ),
            ),
          ),
        ),
      )
    : h("p", { class: "muted" }, "Nenhuma sala.");

  const banForm = h(
    "form",
    {
      class: "ban-form",
      onsubmit: (event) => {
        event.preventDefault();
        const target = adminData.users.find((u) => u.fingerprint === $("ban-fp").value.trim().toUpperCase());
        if (!confirm(`Banir ${target ? target.name : "esta impressão digital"}? ${target?.online ? "A pessoa é desconectada agora e este" : "Este"} dispositivo não poderá mais entrar.`)) return;
        act(() => sl.invoke("admin:ban", $("ban-fp").value, $("ban-reason").value).then(() => {
          $("ban-fp").value = "";
          $("ban-reason").value = "";
          return refreshAdmin();
        }), "Impressão digital banida");
      },
    },
    h("input", { id: "ban-fp", class: "mono", required: true, placeholder: "Impressão digital para banir (XXXX-XXXX-…)" }),
    h("input", { id: "ban-reason", placeholder: "Motivo (opcional)" }),
    h("button", { class: "danger" }, "Banir"),
  );

  const bansTable = bans.length
    ? h(
        "table",
        { class: "table" },
        h("thead", {}, h("tr", {}, ["Impressão digital", "Usuário", "Motivo", "Banido", ""].map((t) => h("th", {}, t)))),
        h(
          "tbody",
          {},
          bans.map((b) =>
            h(
              "tr",
              {},
              h("td", { class: "mono" }, b.fingerprint),
              h("td", {}, b.userName ?? h("span", { class: "muted" }, "nunca entrou")),
              h("td", {}, b.reason || h("span", { class: "muted" }, "—")),
              h("td", {}, ago(b.createdAt)),
              h("td", { class: "actions" }, h("button", { class: "ghost", onclick: () => act(() => sl.invoke("admin:unban", b.fingerprint).then(refreshAdmin), "Desbanido") }, "Desbanir")),
            ),
          ),
        ),
      )
    : h("p", { class: "muted", style: "margin-top: 10px" }, "Ninguém está banido.");

  content.replaceChildren(
    h("div", { class: "room-head" }, h("div", {}, h("h1", {}, "Admin"), h("div", { class: "meta" }, "Todo mundo neste servidor. O conteúdo das transmissões e os códigos de convite ficam privados a cada sala."))),
    h("div", { class: "tiles" }, tile(stats.users, "usuários"), tile(stats.online, "online agora"), tile(stats.rooms, "salas"), tile(stats.streams, "transmissões ao vivo"), tile(bans.length, "banidos")),
    h("section", {}, h("h3", {}, "Usuários"), usersTable),
    h("section", {}, h("h3", {}, "Salas"), roomsTable),
    h("section", {}, h("h3", {}, "Banimentos"), banForm, bansTable),
  );
  $("ban-fp").value = typed.fp;
  $("ban-reason").value = typed.reason;
  if (typed.focus === "ban-fp" || typed.focus === "ban-reason") $(typed.focus).focus();
}

// ---------- share dialog ----------

let shareRoom = null;
let sources = [];
let sourceKind = "screen";
let sourceId = null;

async function openShare(room) {
  shareRoom = room;
  const dialog = openDialog("share-dialog");
  const form = dialog.querySelector("form");
  const d = state.settings.share;
  form.resolution.value = d.resolution;
  form.fps.value = String(d.fps);
  form.codec.value = d.codec;
  form.hint.value = d.hint;
  form.capacity.value = String(d.capacity);
  form.audio.value = d.audio ? "system" : "off";
  form.bitrate.value = String(Math.round(d.bitrate / 1e6));
  delete form.title.dataset.touched;
  $("share-room").textContent = `em ${room.name}`;
  updateBitrate();
  $("portal-note").hidden = !state.portalPicker;
  $("source-picker").hidden = state.portalPicker;
  sourceId = null;
  if (!state.portalPicker) await loadSources();
}

async function loadSources() {
  $("sources").replaceChildren(h("p", { class: "muted" }, "Carregando…"));
  sources = (await act(() => sl.invoke("sources:list"))) ?? [];
  if (!sources.some((s) => s.id === sourceId)) sourceId = sources.find((s) => s.kind === sourceKind)?.id ?? null;
  renderSources();
}

function renderSources() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.kind === sourceKind));
  const list = sources.filter((s) => s.kind === sourceKind);
  $("sources").replaceChildren(
    ...(list.length
      ? list.map((s) =>
          h(
            "button",
            {
              type: "button",
              class: `source${s.id === sourceId ? " on" : ""}`,
              onclick: () => {
                sourceId = s.id;
                const title = $("share-form").title;
                if (!title.dataset.touched) title.value = s.kind === "window" ? s.name : "";
                renderSources();
              },
            },
            h("div", { class: "thumb", style: s.thumbnail ? `background-image: url("${s.thumbnail}")` : "" }),
            h("div", { class: "label" }, s.icon ? h("img", { src: s.icon, alt: "" }) : null, h("span", { class: "ellipsis" }, s.name)),
          ),
        )
      : [h("p", { class: "muted" }, sourceKind === "screen" ? "Nenhuma tela encontrada." : "Nenhuma janela encontrada.")]),
  );
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    sourceKind = tab.dataset.kind;
    renderSources();
  };
});
$("refresh-sources").onclick = loadSources;
$("share-form").title.addEventListener("input", (e) => (e.target.dataset.touched = "1"));

function updateBitrate() {
  const form = $("share-form");
  const mbps = Number(form.bitrate.value);
  $("bitrate-out").textContent = `${mbps} Mbps`;
  $("upload-need").textContent = `até ${mbps * Number(form.capacity.value)} Mbps (${mbps} × ${form.capacity.value})`;
  $("audio-note").hidden = form.audio.value !== "system";
}
$("share-form").bitrate.addEventListener("input", updateBitrate);
$("share-form").capacity.addEventListener("change", updateBitrate);
$("share-form").audio.addEventListener("change", updateBitrate);

dialogForm("share-dialog", async (form) => {
  if (!state.portalPicker && !sourceId) throw new Error("Escolha uma tela ou uma janela.");
  await sl.invoke("share:start", {
    roomId: shareRoom.id,
    title: form.title.value.trim() || (sources.find((s) => s.id === sourceId)?.kind === "screen" ? "Tela" : ""),
    sourceId,
    settings: {
      resolution: form.resolution.value,
      fps: Number(form.fps.value),
      bitrate: Number(form.bitrate.value) * 1e6,
      codec: form.codec.value,
      hint: form.hint.value,
      capacity: Number(form.capacity.value),
      audio: form.audio.value === "system",
    },
  });
  delete form.title.dataset.touched;
  toast(`Compartilhando em ${shareRoom.name}`);
});

// ---------- boot ----------

state = await sl.invoke("state:get");
render();
