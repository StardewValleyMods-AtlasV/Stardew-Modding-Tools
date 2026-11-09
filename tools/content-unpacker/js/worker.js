// Coordinator: reads the uploaded zip, unpacks every .xnb (in parallel using
// nested workers when available), and builds the "(unpacked)" zip.
import "./vendor/jszip.min.js";
import { decodeXnb } from "./decode.js";

const JSZip = self.JSZip;

const TEXT_EXT = new Set(["json", "yaml", "yml", "xml", "txt", "tbin"]);

class PoolWorker {
	constructor() {
		this.nextId = 1;
		this.pending = new Map();
		this.worker = new Worker(new URL("./xnbWorker.js", import.meta.url), { type: "module" });
		this.worker.onmessage = (e) => {
			const job = this.pending.get(e.data.id);
			if (!job) return;
			this.pending.delete(e.data.id);
			if (e.data.error) job.reject(new Error(e.data.error));
			else job.resolve(e.data.files);
		};
		this.worker.onerror = (e) => {
			const err = new Error(e.message || "Worker crashed");
			for (const job of this.pending.values()) job.reject(err);
			this.pending.clear();
		};
	}
	decode(req) {
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.worker.postMessage({ ...req, id }, [req.buffer]);
		});
	}
	close() {
		this.worker.terminate();
	}
}

function makePool(size) {
	if (typeof Worker === "undefined") return null;
	try {
		return Array.from({ length: size }, () => new PoolWorker());
	} catch (err) {
		return null; // nested workers unsupported: fall back to decoding inline
	}
}

function splitPath(path) {
	const i = path.lastIndexOf("/");
	return i === -1 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
}

function extOf(name) {
	const i = name.lastIndexOf(".");
	return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

function stripExt(name) {
	const i = name.lastIndexOf(".");
	return i === -1 ? name : name.slice(0, i);
}

const post = (msg) => self.postMessage(msg);

self.onmessage = async (e) => {
	if (e.data.type !== "start") return;
	try {
		await run(e.data);
	} catch (err) {
		post({ type: "error", message: String((err && err.message) || err) });
	}
};

async function run({ file, yaml, contentOnly, copyOthers, threads }) {
	post({ type: "progress", phase: "read", done: 0, total: 0, current: "Reading zip…" });
	const inZip = await JSZip.loadAsync(file);

	const all = Object.values(inZip.files).filter(
		(f) => !f.dir && !f.name.startsWith("__MACOSX/") && !/(^|\/)\.DS_Store$/.test(f.name) && !/(^|\/)Thumbs\.db$/i.test(f.name)
	);
	const xnbs = all.filter((f) => extOf(f.name) === "xnb");
	const others = all.filter((f) => extOf(f.name) !== "xnb");

	if (xnbs.length === 0) {
		throw new Error("No .xnb files found in this zip. Zip the Stardew Valley Content folder and try again.");
	}

	// Work out the output folder name. A single top-level folder (e.g. "Content/")
	// is renamed to "<name> (unpacked)/"; loose files are wrapped in one.
	const tops = new Set(all.map((f) => (f.name.includes("/") ? f.name.split("/")[0] : null)));
	let rootIn = "";
	let rootOut;
	if (tops.size === 1 && !tops.has(null)) {
		const [top] = tops;
		rootIn = top + "/";
		rootOut = `${top} (unpacked)/`;
	} else {
		rootOut = "Content (unpacked)/";
	}
	const mapPath = (p) => rootOut + (rootIn && p.startsWith(rootIn) ? p.slice(rootIn.length) : p);

	const outZip = new JSZip();
	const errors = [];
	const typeCounts = {};
	let ok = 0;
	let done = 0;
	let lastPost = 0;
	const total = xnbs.length;

	const report = (current, force = false) => {
		const now = Date.now();
		if (!force && now - lastPost < 80) return;
		lastPost = now;
		post({ type: "progress", phase: "unpack", done, total, current });
	};

	const poolSize = Math.max(1, Math.min(threads || 1, xnbs.length));
	const pool = makePool(poolSize);
	let cursor = 0;

	const lane = async (poolWorker) => {
		while (true) {
			const i = cursor++;
			if (i >= xnbs.length) return;
			const entry = xnbs[i];
			const [dir, name] = splitPath(entry.name);
			const baseName = stripExt(name);
			try {
				const buffer = await entry.async("arraybuffer");
				const req = { buffer, baseName, yaml, contentOnly };
				const files = poolWorker ? await poolWorker.decode(req) : await decodeXnb(req);
				for (const { extension, bytes } of files) {
					typeCounts[extension] = (typeCounts[extension] || 0) + 1;
					outZip.file(mapPath(`${dir}${baseName}.${extension}`), bytes, {
						binary: true,
						compression: TEXT_EXT.has(extension) ? "DEFLATE" : "STORE",
					});
				}
				ok++;
			} catch (err) {
				errors.push({ path: entry.name, message: String((err && err.message) || err) });
			}
			done++;
			report(entry.name);
		}
	};

	if (pool) await Promise.all(pool.map(lane));
	else await lane(null);
	if (pool) pool.forEach((p) => p.close());
	report("", true);

	let copied = 0;
	if (copyOthers) {
		for (const entry of others) {
			const bytes = await entry.async("uint8array");
			outZip.file(mapPath(entry.name), bytes, {
				binary: true,
				compression: TEXT_EXT.has(extOf(entry.name)) ? "DEFLATE" : "STORE",
			});
			copied++;
		}
	}

	if (errors.length) {
		const log = [`${errors.length} of ${total} .xnb files could not be unpacked:`, ""]
			.concat(errors.map((x) => `${x.path}\n    ${x.message}`))
			.join("\n");
		outZip.file(rootOut + "_unpack-errors.txt", log, { compression: "DEFLATE" });
	}

	post({ type: "progress", phase: "zip", done: 0, total: 100, current: "Building zip…" });
	const blob = await outZip.generateAsync({ type: "blob", streamFiles: true }, (m) => {
		const now = Date.now();
		if (now - lastPost < 80) return;
		lastPost = now;
		post({ type: "progress", phase: "zip", done: Math.round(m.percent), total: 100, current: m.currentFile || "" });
	});

	const inName = file.name.replace(/\.zip$/i, "");
	post({
		type: "done",
		blob,
		name: `${inName} (unpacked).zip`,
		stats: { total, ok, failed: errors.length, copied, skippedOthers: copyOthers ? 0 : others.length, typeCounts, errors },
	});
}
