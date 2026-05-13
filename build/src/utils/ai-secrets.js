"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskAiSecret = exports.decryptAiSecret = exports.encryptAiSecret = void 0;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = __importDefault(require("./config"));
const ENCRYPTION_SECRET = process.env.AI_SETTINGS_ENCRYPTION_SECRET || config_1.default.secretKey;
const ALGORITHM = 'aes-256-gcm';
const getKey = () => crypto_1.default.createHash('sha256').update(ENCRYPTION_SECRET).digest();
const encryptAiSecret = (value) => {
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};
exports.encryptAiSecret = encryptAiSecret;
const decryptAiSecret = (value) => {
    if (!value)
        return '';
    const [ivHex, authTagHex, encryptedHex] = value.split(':');
    if (!ivHex || !authTagHex || !encryptedHex)
        return '';
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
};
exports.decryptAiSecret = decryptAiSecret;
const maskAiSecret = (value) => {
    if (!value)
        return null;
    const last4 = value.slice(-4);
    const maskLength = Math.max(4, value.length - 4);
    return `${'•'.repeat(maskLength)}${last4}`;
};
exports.maskAiSecret = maskAiSecret;
