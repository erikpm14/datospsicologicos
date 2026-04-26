require('dotenv').config();
const videoUse = require('../../../../integrations/video-use');

module.exports = {
  renderWithVideoUse: videoUse.renderWithVideoUse,
  checkVideoUseAvailability: videoUse.checkVideoUseAvailability,
  buildVideoUseInput: videoUse.buildVideoUseInput,
};
