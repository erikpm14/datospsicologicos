import { Config } from '@remotion/cli/config';

Config.setCodec('h264');
Config.setCrf(23);

export const videoConfig = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 900, // 30 segundos @ 30fps (default)
  backgroundColor: '#000000',
};
