// Decodes a single .xnb buffer into its unpacked files: [{ extension, bytes }]
import { bufferToXnb, xnbDataToFiles } from "./libs/xnb.js";

export async function decodeXnb({ buffer, baseName, yaml, contentOnly }) {
	const data = bufferToXnb(buffer);
	const files = await xnbDataToFiles(data, { yaml, contentOnly, fileName: baseName });
	const out = [];
	for (const { data: blob, extension } of files) {
		let bytes;
		if (typeof blob.arrayBuffer === "function") bytes = new Uint8Array(await blob.arrayBuffer());
		else bytes = new Uint8Array(blob);
		out.push({ extension, bytes });
	}
	return out;
}
