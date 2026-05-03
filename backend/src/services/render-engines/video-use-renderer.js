require('dotenv').config();
const path = require('path');
// Resolve absolute path to integrations/video-use from this file's location
const videoUsePath = path.resolve(__dirname, '../../../integrations/video-use');
const videoUse = require(videoUsePath);

module.exports = {
  renderWithVideoUse: videoUse.renderWithVideoUse,
  checkVideoUseAvailability: videoUse.checkVideoUseAvailability,
  buildVideoUseInput: videoUse.buildVideoUseInput,
};
