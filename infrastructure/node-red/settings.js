module.exports = {
  flowFile: "flows.json",
  credentialSecret: false,
  uiPort: process.env.PORT || 1880,
  functionGlobalContext: {},
  logging: { console: { level: "info", metrics: false, audit: false } }
};
