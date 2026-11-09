const $ = (id) => document.getElementById(id);
const TILES = 40;

const els = {
	drop: $("drop"), input: $("zipInput"), fileInfo: $("fileInfo"),
	pick: $("pick"), options: $("options"), working: $("working"), result: $("result"),
	start: $("start"), cancel: $("cancel"), again: $("again"), download: $("download"),
	field: $("field"), status: $("status"), current: $("current"), summary: $("summary"),
	errorsBox: $("errorsBox"), errorsTitle: $("errorsTitle"), errorsList: $("errorsList"),
	fatal: $("fatal"), copyOthers: $("copyOthers"),
};

let file = null;
let worker = null;
let downloadUrl = null;
let startedAt = 0;

els.field.append(...Array.from({ length: TILES }, () => document.createElement("i")));
const tiles = [...els.field.children];

function fmtSize(bytes) {
	if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
	if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
	return Math.max(1, Math.round(bytes / 1e3)) + " KB";
}
function fmtTime(ms) {
	const s = Math.round(ms / 1000);
	return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function fatal(message) {
	els.fatal.textContent = message;
	els.fatal.hidden = !message;
}

function show(section) {
	for (const key of ["pick", "options", "working", "result"]) els[key].hidden = true;
	els.pick.hidden = !(section === "pick" || section === "options");
	if (section !== "pick") els[section === "options" ? "options" : section].hidden = false;
}

function setFile(f) {
	fatal("");
	if (!f) return;
	if (!/\.zip$/i.test(f.name)) {
		fatal("That isn't a .zip file. Zip the Content folder first, then drop the zip here.");
		return;
	}
	file = f;
	els.fileInfo.textContent = `${f.name} (${fmtSize(f.size)})`;
	els.fileInfo.hidden = false;
	show("options");
}

function setProgress(fraction) {
	const on = Math.round(fraction * TILES);
	tiles.forEach((t, i) => t.classList.toggle("on", i < on));
	els.field.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
}

function reset() {
	if (worker) { worker.terminate(); worker = null; }
	if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
	file = null;
	els.input.value = "";
	els.fileInfo.hidden = true;
	fatal("");
	show("pick");
}

function start() {
	if (!file) return;
	if (typeof Worker === "undefined") {
		fatal("This browser doesn't support web workers. Try a recent version of Chrome, Edge, Firefox or Safari.");
		return;
	}
	fatal("");
	const format = document.querySelector('input[name="format"]:checked').value;
	const threads = Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 4));

	try {
		worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
	} catch (err) {
		fatal("This browser can't run module workers. Try a recent version of Chrome, Edge, Firefox or Safari.");
		return;
	}

	startedAt = Date.now();
	setProgress(0);
	els.status.textContent = "Reading zip…";
	els.current.textContent = "";
	show("working");

	worker.onmessage = (e) => {
		const m = e.data;
		if (m.type === "progress") {
			if (m.phase === "read") {
				els.status.textContent = "Reading zip…";
				setProgress(0);
			} else if (m.phase === "unpack") {
				els.status.textContent = `Unpacked ${m.done} of ${m.total} files`;
				setProgress(m.total ? (m.done / m.total) * 0.9 : 0);
			} else {
				els.status.textContent = "Building the new zip…";
				setProgress(0.9 + (m.done / 100) * 0.1);
			}
			els.current.textContent = m.current || "";
		} else if (m.type === "done") {
			finish(m);
		} else if (m.type === "error") {
			worker.terminate(); worker = null;
			fatal(m.message);
			show("options");
		}
	};
	worker.onerror = (e) => {
		worker.terminate(); worker = null;
		fatal(`Something went wrong while unpacking: ${e.message || "the worker crashed"}. If the zip is very large, try a smaller one or turn off copying non-.xnb files.`);
		show("options");
	};
	worker.postMessage({
		type: "start",
		file,
		yaml: format === "yaml",
		contentOnly: format === "content",
		copyOthers: els.copyOthers.checked,
		threads,
	});
}

function finish({ blob, name, stats }) {
	worker.terminate(); worker = null;
	setProgress(1);
	if (downloadUrl) URL.revokeObjectURL(downloadUrl);
	downloadUrl = URL.createObjectURL(blob);
	els.download.href = downloadUrl;
	els.download.download = name;
	els.download.textContent = `Download ${name} (${fmtSize(blob.size)})`;

	const parts = [`Unpacked ${stats.ok} of ${stats.total} .xnb files in ${fmtTime(Date.now() - startedAt)}.`];
	const plural = (n) => (n === 1 ? "file" : "files");
	if (stats.copied) parts.push(`Copied ${stats.copied} other ${plural(stats.copied)}.`);
	else if (stats.skippedOthers) parts.push(`Left out ${stats.skippedOthers} ${plural(stats.skippedOthers)} that ${stats.skippedOthers === 1 ? "isn't" : "aren't"} .xnb.`);
	els.summary.textContent = parts.join(" ");

	if (stats.failed) {
		els.errorsTitle.textContent = `${stats.failed} file${stats.failed === 1 ? "" : "s"} couldn't be unpacked`;
		els.errorsList.textContent = stats.errors.map((x) => `${x.path}\n    ${x.message}`).join("\n");
		els.errorsBox.hidden = false;
	} else {
		els.errorsBox.hidden = true;
	}
	show("result");
}

// Events
els.input.addEventListener("change", () => setFile(els.input.files[0]));
els.drop.addEventListener("keydown", (e) => {
	if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.input.click(); }
});
for (const type of ["dragenter", "dragover"]) {
	els.drop.addEventListener(type, (e) => { e.preventDefault(); els.drop.classList.add("over"); });
}
for (const type of ["dragleave", "drop"]) {
	els.drop.addEventListener(type, (e) => { e.preventDefault(); els.drop.classList.remove("over"); });
}
els.drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));
els.start.addEventListener("click", start);
els.cancel.addEventListener("click", () => {
	if (worker) { worker.terminate(); worker = null; }
	show("options");
});
els.again.addEventListener("click", reset);

show("pick");
