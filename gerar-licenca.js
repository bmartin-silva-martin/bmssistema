/**
 * Gerador de licencas BMS Sistema
 *
 * USO:
 *   node gerar-licenca.js <INSTALL_ID> <DIAS>
 *
 * EXEMPLOS:
 *   node gerar-licenca.js abc123-uuid-aqui 30
 *   node gerar-licenca.js abc123-uuid-aqui 90
 *
 * REQUISITO:
 *   Arquivo "private_key.pem" na mesma pasta deste script.
 *   (nunca envie esse arquivo para o GitHub)
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [, , installId, diasStr] = process.argv;

if (!installId || !diasStr) {
  console.error("Uso: node gerar-licenca.js <INSTALL_ID> <DIAS>");
  console.error("Ex:  node gerar-licenca.js meu-uuid-aqui 30");
  process.exit(1);
}

const dias = parseInt(diasStr, 10);
if (isNaN(dias) || dias <= 0) {
  console.error("DIAS deve ser um numero positivo.");
  process.exit(1);
}

const keyPath = path.join(__dirname, "private_key.pem");
if (!fs.existsSync(keyPath)) {
  console.error("Arquivo private_key.pem nao encontrado.");
  console.error("Coloque o arquivo na pasta: " + __dirname);
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, "utf8");

function base64urlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const payload = JSON.stringify({
  installId,
  daysToAdd: dias,
  nonce: crypto.randomBytes(16).toString("hex"),
  issuedAt: Date.now(),
});

const payloadBuffer = Buffer.from(payload, "utf8");
const signer = crypto.createSign("RSA-SHA256");
signer.update(payloadBuffer);
signer.end();
const signature = signer.sign(privateKey);

const token = base64urlEncode(payloadBuffer) + "." + base64urlEncode(signature);

console.log("\n========================================");
console.log("  TOKEN DE LICENCA GERADO");
console.log("========================================");
console.log("Install ID : " + installId);
console.log("Dias       : " + dias);
console.log("Validade   : " + new Date(Date.now() + dias * 86400000).toLocaleDateString("pt-BR"));
console.log("----------------------------------------");
console.log("\nCopie e envie este token para o cliente:\n");
console.log(token);
console.log("\n========================================\n");
console.log("ATENCAO: este token expira em 7 dias apos a geracao.");
