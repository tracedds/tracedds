import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.VERCEL
  ? path.join(tmpdir(), "medmkp")
  : path.join(process.cwd(), ".data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const REQUESTS_FILE = path.join(DATA_DIR, "requests.json");

async function ensureStore() {
  await mkdir(UPLOAD_DIR, { recursive: true });

  try {
    await readFile(REQUESTS_FILE, "utf8");
  } catch {
    await writeFile(REQUESTS_FILE, JSON.stringify([], null, 2));
  }
}

async function readRequests() {
  await ensureStore();
  const body = await readFile(REQUESTS_FILE, "utf8");
  return JSON.parse(body);
}

async function writeRequests(requests) {
  await ensureStore();
  await writeFile(REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function listRequests() {
  const requests = await readRequests();
  return requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createRequest({
  file,
  clinic,
  buyer,
  shippingAddress,
  preference,
  vendor,
  invoiceNumber,
  lineItems,
  matchSummary,
  matchSource,
}) {
  const requests = await readRequests();
  const id = `req_${randomUUID()}`;
  const storedFileName = `${id}_${sanitizeFileName(file.name || "upload")}`;
  const storedFilePath = path.join(UPLOAD_DIR, storedFileName);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(storedFilePath, bytes);

  const procurementRequest = {
    id,
    clinic,
    buyer,
    shippingAddress,
    preference,
    vendor,
    invoiceNumber,
    sourceFileName: file.name || "upload",
    storedFilePath,
    status: "parsed",
    createdAt: new Date().toISOString(),
    lineItems,
    matchSummary,
    matchSource,
  };

  requests.unshift(procurementRequest);
  await writeRequests(requests);

  return procurementRequest;
}
