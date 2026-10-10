// Server templates are generated and ignored by Git. Prepare them for direct
// `npx jest` as well as npm test, including on a fresh checkout.
module.exports = async () => {
  require('../functions/scripts/copy-template.js');
};
