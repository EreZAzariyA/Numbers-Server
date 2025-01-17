"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = __importDefault(require("./utils/config"));
const dal_1 = __importDefault(require("./dal/dal"));
const errors_handler_1 = __importDefault(require("./middlewares/errors-handler"));
const verify_token_1 = __importDefault(require("./middlewares/verify-token"));
const authentication_1 = __importDefault(require("./routes/authentication"));
const users_1 = __importDefault(require("./routes/users"));
const transactions_1 = __importDefault(require("./routes/transactions"));
const categories_1 = __importDefault(require("./routes/categories"));
const bank_1 = __importDefault(require("./routes/bank"));
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '10mb' }));
app.use((0, cors_1.default)({
    origin: [
        'http://127.0.0.1:3000',
        'http://localhost:3000',
        'http://localhost:3001',
        'https://ea-numbers.vercel.app',
        'https://ea-numbers-test.vercel.app',
    ],
    credentials: true
}));
app.use('/api/auth', authentication_1.default);
app.use('/api/users', verify_token_1.default, users_1.default);
app.use('/api/transactions', verify_token_1.default, transactions_1.default);
app.use('/api/categories', verify_token_1.default, categories_1.default);
app.use('/api/banks', verify_token_1.default, bank_1.default);
app.use("*", (_, res) => {
    res.status(404).send('Route Not Found');
});
app.listen(config_1.default.port, () => {
    console.log(`Listening on port: ${config_1.default.port}, isProduction: ${config_1.default.isProduction}`);
    (0, dal_1.default)().then((collectionName) => {
        console.log(`Successfully connected to: ${collectionName}`);
    });
});
app.use(errors_handler_1.default);
exports.default = app;
