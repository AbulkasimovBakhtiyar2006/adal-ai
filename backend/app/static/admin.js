"use strict";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let adminKey = "";
let records = [];
let selectedRecord = null;
let pollTimer = null;
let recorder = null;
let recordStream = null;
let recordTimer = null;
const settingsForm = $("#settings-form");
const dialog = $("#document-dialog");
const labels = {settings: "Настройки ИИ", documents: "База знаний", playground: "Проверка бота"};
const errors = {
  corpus_not_configured: "Сначала включите проверенные документы в базе знаний.",
  configuration_missing: "Заполните ключи и модели в настройках ИИ.",
  admin_unauthorized: "Неверный ключ администратора.",
  admin_localhost_only_set_ADMIN_API_KEY_for_remote: "Без ADMIN_API_KEY управление доступно только с localhost.",
  invalid_settings: "Проверьте названия моделей, проект Google и пороги от 0 до 1.",
  save_api_key_first: "Сначала сохраните API-ключ.",
  provider_connection_failed: "Провайдер не подтвердил подключение. Проверьте ключ и доступ к API.",
  audio_unavailable_check_gemini_settings: "Расшифровка недоступна. Проверьте ключ Gemini и модель для аудио.",
  no_speech_detected: "Разборчивую речь не удалось распознать. Попробуйте другую запись.",
  audio_too_long: "Запись должна быть не длиннее 3 минут.",
  audio_too_long_or_empty: "Запись пуста или длиннее 3 минут.",
  invalid_audio_file: "Не удалось прочитать аудиофайл.",
  audio_file_required: "Нужен звуковой файл без видеодорожки.",
  unsupported_audio_format: "Поддерживаются WAV, MP3, OGG, FLAC, AAC, M4A и WebM.",
  file_empty_or_too_large: "Файл пуст или превышает допустимый размер.",
  paragraph_too_long_split_manually: "В тексте слишком длинный абзац. Разделите его на смысловые абзацы.",
  section_too_short_review_structure: "Проверьте структуру: обнаружен отдельный слишком короткий раздел.",
  cannot_parse_document: "Не удалось разобрать документ. Проверьте формат и содержимое.",
  no_text_found_ocr_may_be_required: "Текст не найден. Возможно, это скан, которому сначала нужен OCR.",
  unsupported_format: "Используйте TXT, MD, PDF, DOCX или HTML.",
  text_too_short: "Добавьте не менее 30 символов текста.",
  official_source_url_required: "Для включения нужна HTTPS-ссылка на разрешённый официальный источник.",
  title_and_verified_revision_required: "Укажите название и проверенную редакцию.",
  source_marked_not_actual: "Источник отмечен в официальной базе как неактуальный. Его нельзя включить.",
  collection_already_running: "Загрузка источников уже выполняется.",
  busy: "Сервис занят. Повторите через несколько секунд.",
  invalid_request: "Проверьте заполненные поля и длину вопроса.",
};
const warningLabels = {
  verify_current_revision_before_activation: "Сверьте действующую редакцию с официальным сайтом.",
  source_marked_not_actual: "Официальная база пометила источник как неактуальный.",
  parsed_text_changed_review_again: "Текст изменился после повторного разбора — просмотрите его заново.",
  check_tables_footnotes_and_tracked_changes: "Проверьте таблицы, сноски и исправления в Word.",
  some_pages_need_ocr: "На части страниц нет текста: потребуется распознавание скана.",
  check_pdf_reading_order_and_tables: "Проверьте порядок абзацев и таблицы в PDF.",
  decoded_as_windows_1251_check_kazakh_letters: "Проверьте кодировку и казахские буквы.",
};
function notify(text, error = false) {
  const notice = dialog.open ? $("#dialog-notice") : $("#notice");
  notice.textContent = text;
  notice.classList.remove("hidden");
  notice.classList.toggle("error", error);
}
function errorText(error) { return errors[error.message] || error.message || "Не удалось выполнить запрос."; }
function headers() {
  const result = {"X-Adal-Admin": "1"};
  if (adminKey) result.Authorization = `Bearer ${adminKey}`;
  return result;
}
async function api(path, options = {}) {
  const request = {...options, headers: {...headers(), ...(options.headers || {})}};
  if (request.body && !(request.body instanceof FormData)) {
    request.headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(request.body);
  }
  let response;
  try { response = await fetch(`/admin/api${path}`, request); }
  catch { throw new Error("Сервер недоступен. Проверьте, что backend запущен."); }
  const result = await response.json();
  if (response.status === 401) $("#unlock").classList.remove("hidden");
  if (!response.ok && !result.answer) throw new Error(typeof result.detail === "string" ? result.detail : "Ошибка запроса.");
  return result;
}
async function action(button, callback) {
  button.disabled = true;
  try { await callback(); }
  catch (error) { notify(errorText(error), true); }
  finally { button.disabled = false; }
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function sourceLink(url, text) {
  const node = element("a", text);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      node.href = parsed.href; node.target = "_blank"; node.rel = "noopener noreferrer";
    }
  } catch { /* Invalid URLs remain plain text. */ }
  return node;
}
function fillSettings(settings) {
  for (const [name, value] of Object.entries(settings)) {
    const input = settingsForm.elements.namedItem(name);
    if (input && input.type !== "password") input.value = value;
  }
  if (!settingsForm.elements.critic_model.value) settingsForm.elements.critic_model.value = "deepseek-flash";
  for (const prefix of ["deepseek", "gemini", "critic"]) {
    const saved = settings.configured_keys[`${prefix}_api_key`];
    $(`#${prefix}-key-state`).textContent = saved ? "Ключ сохранён" : "Не задан";
    const input = settingsForm.elements.namedItem(`${prefix}_api_key`);
    input.value = "";
    input.placeholder = saved ? "Оставьте пустым, чтобы сохранить текущий" : "Вставьте API-ключ";
  }
  $("#same-model").classList.toggle("hidden", !settings.same_model_for_generation_and_critic);
}
async function refresh(fill = false) {
  const status = await api("/status");
  if (fill) fillSettings(status.settings);
  $("#stat-docs").textContent = status.documents;
  $("#stat-active").textContent = status.active_documents;
  $("#stat-chunks").textContent = status.fresh_chunks;
  $("#nav-count").textContent = status.documents;
  const ready = !status.settings.missing_configuration.length && status.fresh_chunks > 0;
  $("#service-state").textContent = ready ? "Настроено · API ещё нужно проверить" : "Нужна настройка";
  $("#service-state").classList.toggle("warn", !ready);
  const job = status.collection;
  const running = ["running", "starting"].includes(job.status);
  $("#download-sources").disabled = running;
  if (running) {
    $("#collection-status").textContent = `Загрузка: ${job.completed || 0} из ${job.total || status.catalog_size}. Документы сохраняются для просмотра.`;
    if (!pollTimer) pollTimer = setTimeout(async () => {
      pollTimer = null;
      try { await refresh(); await loadDocuments(); } catch (error) { notify(errorText(error), true); }
    }, 2500);
  } else if (job.status === "completed") {
    $("#collection-status").textContent = `Скачано ${job.downloaded} из ${job.total} источников. Просмотрите документы и включите нужные в поиск. Ошибок: ${job.errors.length}.`;
  } else if (job.status === "failed") {
    $("#collection-status").textContent = "Загрузка прервана. Уже сохранённые документы доступны. Можно повторить загрузку.";
  }
  $("#error-list").replaceChildren();
  for (const error of job.errors || []) {
    const row = element("li"); row.append(sourceLink(error.url, `${error.title} (${error.id})`), element("span", ` — ${error.reason}`));
    $("#error-list").append(row);
  }
  $("#collection-errors").classList.toggle("hidden", !(job.errors || []).length);
  return status;
}
function showTab(tab) {
  for (const button of $$("[data-tab]")) button.classList.toggle("selected", button.dataset.tab === tab);
  for (const panel of $$(".tab")) panel.classList.toggle("hidden", panel.id !== `tab-${tab}`);
  $("#breadcrumb").textContent = labels[tab];
  if (tab === "documents") loadDocuments().catch(error => notify(errorText(error), true));
}
for (const button of $$("[data-tab]")) button.addEventListener("click", () => showTab(button.dataset.tab));
$("#unlock-form").addEventListener("submit", async event => {
  event.preventDefault(); adminKey = $("#admin-key").value; $("#admin-key").value = "";
  await action(event.submitter, async () => { await refresh(true); $("#unlock").classList.add("hidden"); notify("Доступ открыт."); });
});
settingsForm.addEventListener("submit", async event => {
  event.preventDefault();
  await action(event.submitter, async () => {
    const data = Object.fromEntries(new FormData(settingsForm));
    for (const key of Object.keys(data)) {
      if (key.endsWith("_api_key") && !data[key].trim()) delete data[key];
      if (key.startsWith("grounding_")) data[key] = Number(data[key]);
    }
    const result = await api("/settings", {method: "PATCH", body: data});
    fillSettings(result); await refresh(); notify("Настройки сохранены и применены. Перезапуск не нужен.");
  });
});
for (const button of $$("[data-clear]")) button.addEventListener("click", () => action(button, async () => {
  const result = await api("/settings", {method: "PATCH", body: {clear_keys: [button.dataset.clear]}});
  fillSettings(result); await refresh(); notify("Ключ удалён.");
}));
for (const button of $$("[data-check]")) button.addEventListener("click", () => action(button, async () => {
  const result = await api(`/check/${button.dataset.check}`, {method: "POST"});
  const list = $(`#${button.dataset.check}-models`); list.replaceChildren();
  for (const model of result.models) { const option = element("option"); option.value = model; list.append(option); }
  notify(`Подключение подтверждено. Доступно моделей: ${result.models.length}. Список появился в поле выбора модели.`);
}));
async function loadDocuments() { records = (await api("/documents")).documents; renderDocuments(); }
function renderDocuments() {
  const query = $("#document-search").value.toLocaleLowerCase();
  const filter = $("#document-filter").value;
  const visible = records.filter(record => record.title.toLocaleLowerCase().includes(query) && (filter === "all" || record.status === filter));
  $("#document-count").textContent = `${visible.length} документов`;
  const list = $("#document-list"); list.replaceChildren();
  if (!visible.length) { list.append(element("div", "Документы не найдены. Загрузите файл или скачайте официальные источники.", "empty")); return; }
  const states = {active: "В поиске", pending: "На проверке", archived: "Архив"};
  for (const record of visible) {
    const button = element("button", undefined, "document-row");
    const info = element("span", undefined, "doc-info");
    info.append(element("strong", record.title), element("small", `${record.chunk_count} фрагментов · ${Math.round(record.characters / 1000)} тыс. символов`));
    button.append(element("span", "▤", "doc-icon"), info, element("span", record.language.toUpperCase(), "doc-language"), element("span", states[record.status] || record.status, `pill ${record.status === "active" ? "mint" : ""}`));
    button.addEventListener("click", () => action(button, () => openDocument(record.id))); list.append(button);
  }
}
$("#document-search").addEventListener("input", renderDocuments);
$("#document-filter").addEventListener("change", renderDocuments);
$("#download-sources").addEventListener("click", event => action(event.currentTarget, async () => {
  await api("/sources/download", {method: "POST"}); await refresh(); notify("Скачивание началось. Можно продолжать настройку.");
}));
$("#upload-form").addEventListener("submit", event => {
  event.preventDefault(); action(event.submitter, async () => {
    const data = new FormData(event.target);
    const file = data.get("file");
    if (!file || !file.size) data.delete("file");
    const record = await api("/documents", {method: "POST", body: data});
    event.target.reset(); await refresh(); await loadDocuments(); await openDocument(record.id);
  });
});
async function openDocument(id) {
  selectedRecord = await api(`/documents/${id}`);
  const record = selectedRecord;
  $("#detail-heading").textContent = record.title;
  $("#detail-meta").textContent = `${record.language.toUpperCase()} · ${record.characters.toLocaleString()} символов · ${record.chunk_count} фрагментов`;
  $("#detail-source-meta").textContent = JSON.stringify({downloaded_at: record.downloaded_at, sha256: record.sha256, ...record.source_metadata}, null, 2);
  $("#document-text").textContent = record.text;
  const warnings = record.warnings.map(code => warningLabels[code] || code).join(" ");
  $("#detail-warnings").textContent = warnings;
  $("#detail-warnings").classList.toggle("hidden", !warnings);
  const form = $("#activate-form");
  for (const key of ["title", "url", "revision", "language"]) form.elements.namedItem(key).value = record[key] || "";
  form.elements.reviewed.checked = false;
  $("#deactivate").classList.toggle("hidden", record.status !== "active");
  $("#dialog-notice").classList.add("hidden");
  if (!dialog.open) dialog.showModal();
}
$("#activate-form").addEventListener("submit", event => {
  event.preventDefault(); action(event.submitter, async () => {
    const data = Object.fromEntries(new FormData(event.target)); data.reviewed = event.target.elements.reviewed.checked;
    await api(`/documents/${selectedRecord.id}/activate`, {method: "POST", body: data});
    dialog.close(); await refresh(); await loadDocuments(); notify("Документ включён в поиск. Индекс обновлён.");
  });
});
$("#deactivate").addEventListener("click", event => action(event.currentTarget, async () => {
  await api(`/documents/${selectedRecord.id}/deactivate`, {method: "POST"});
  dialog.close(); await refresh(); await loadDocuments(); notify("Документ исключён из поиска.");
}));
$("#download-original").addEventListener("click", event => action(event.currentTarget, async () => {
  const response = await fetch(`/admin/api/documents/${selectedRecord.id}/original`, {headers: headers()});
  if (!response.ok) throw new Error("Не удалось скачать оригинал.");
  const blob = await response.blob(); const url = URL.createObjectURL(blob);
  const link = element("a"); link.href = url; link.download = selectedRecord.filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}));
function renderAnswer(result) {
  const stateLabels = {answered: "Проверки пройдены", insufficient_evidence: "Недостаточно данных", temporarily_unavailable: "Сервис недоступен"};
  $("#answer-state").textContent = stateLabels[result.status] || result.status;
  $("#answer-state").classList.toggle("mint", result.status === "answered");
  $("#answer-text").textContent = result.answer;
  const stages = $("#verification-stages"); stages.replaceChildren();
  const stageLabels = {passed: "Пройдено", rejected: "Отклонено", not_run: "Не запускалось", error: "Ошибка"};
  for (const [key, title] of [["local", "Цитаты и источники"], ["grounding", "Google Grounding"], ["critic", "Модель-критик"]]) {
    const row = element("div", undefined, "stage-row"); row.append(element("span", title), element("b", stageLabels[result.verification[key]])); stages.append(row);
  }
  if (result.verification.support_score !== null) stages.append(element("p", `Балл Google: ${result.verification.support_score}. Это не процент достоверности.`, "helper"));
  if (result.verification.reason_codes.length) stages.append(element("p", result.verification.reason_codes.map(code => errors[code] || code).join(" "), "helper"));
  const sources = $("#answer-sources"); sources.replaceChildren();
  for (const source of result.sources) {
    const node = element("div", undefined, "source-item");
    node.append(sourceLink(source.url, `${source.title} · ${source.section} ↗`));
    for (const claim of result.claims) for (const evidence of claim.evidence) if (evidence.source_id === source.id) node.append(element("blockquote", evidence.quote));
    sources.append(node);
  }
}
$("#ask-form").addEventListener("submit", event => {
  event.preventDefault(); action(event.submitter, async () => {
    $("#answer-state").textContent = "Идёт проверка…";
    const result = await api("/ask", {method: "POST", body: {question: $("#question").value, language: $("#ask-language").value}});
    renderAnswer(result);
  });
});
async function sendAudio(blob, filename) {
  const button = $("#record"); button.disabled = true;
  $("#audio-status").textContent = "Распознаём речь…";
  try {
    const form = new FormData(); form.append("file", blob, filename);
    const result = await api("/audio/transcribe", {method: "POST", body: form});
    $("#question").value = result.text;
    if (["ru", "kk"].includes(result.language)) $("#ask-language").value = result.language;
    $("#audio-status").textContent = `Распознано ${result.duration_seconds} сек. Проверьте текст вопроса перед отправкой.`;
    $("#question").focus();
  } catch (error) { $("#audio-status").textContent = errorText(error); notify(errorText(error), true); }
  finally { button.disabled = false; $("#audio-file").value = ""; }
}
$("#audio-file").addEventListener("change", event => {
  const file = event.target.files[0]; if (file) sendAudio(file, file.name);
});
function stopTracks() { if (recordStream) for (const track of recordStream.getTracks()) track.stop(); recordStream = null; clearTimeout(recordTimer); }
$("#record").addEventListener("click", async () => {
  if (recorder && recorder.state === "recording") { recorder.stop(); return; }
  try {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error("Запись недоступна в этом браузере. Загрузите аудиофайл.");
    recordStream = await navigator.mediaDevices.getUserMedia({audio: true});
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(value => MediaRecorder.isTypeSupported(value));
    if (!mime) throw new Error("Браузер не поддерживает подходящий формат записи.");
    const parts = []; recorder = new MediaRecorder(recordStream, {mimeType: mime});
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    recorder.onstop = () => {
      stopTracks(); $("#record").classList.remove("recording"); $("#record").textContent = "● Записать вопрос";
      const extension = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
      sendAudio(new Blob(parts, {type: mime}), `recording.${extension}`);
    };
    recorder.onerror = () => { stopTracks(); notify("Ошибка записи. Попробуйте загрузить файл.", true); };
    recorder.start(); $("#record").textContent = "■ Завершить запись"; $("#record").classList.add("recording");
    $("#audio-status").textContent = "Микрофон включён. Нажмите «Завершить запись». Максимум 3 минуты.";
    recordTimer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 178000);
  } catch (error) { stopTracks(); notify(error.name === "NotAllowedError" ? "Доступ к микрофону не разрешён. Можно загрузить аудиофайл." : errorText(error), true); }
});
window.addEventListener("pagehide", () => { if (recorder) recorder.onstop = null; stopTracks(); });
refresh(true).catch(error => notify(errorText(error), true));
