// Pool worker: unpacks one .xnb per request.
// Request:  { id, buffer, baseName, yaml, contentOnly }
// Response: { id, files: [{ extension, bytes }] } or { id, error }
import { decodeXnb } from "./decode.js";

self.onmessage = async (e) => {
	const { id } = e.data;
	try {
		const files = await decodeXnb(e.data);
		self.postMessage({ id, files }, files.map((f) => f.bytes.buffer));
	} catch (err) {
		self.postMessage({ id, error: String((err && err.message) || err) });
	}
};
