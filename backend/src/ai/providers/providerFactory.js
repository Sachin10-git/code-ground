const geminiProvider = require("./geminiProvider");

const providers = {
    gemini: geminiProvider,
};

const getProvider = (provider = "gemini") => {

    const selectedProvider = providers[provider];

    if (!selectedProvider) {
        throw new Error(`AI provider '${provider}' is not supported.`);
    }

    return selectedProvider;

};

module.exports = {
    getProvider,
};