import { Logging, LogLevel } from './vendor/mediabunny.mjs';
export * from './vendor/mediabunny.mjs';

// ID3 timed metadata is irrelevant to previews and our video/audio-only output.
// Preserve every other warning and all decoding errors.
export function forwardMediaWarning(args) {
  if (args.length === 1 && args[0] === 'Note: MPEG-TS streams with stream_type 0x15 are not currently supported.') return;
  console.warn(...args);
}
Logging.level = LogLevel.Errors;
Logging.on('warn', forwardMediaWarning);
Logging.on('info', args => console.info(...args));
