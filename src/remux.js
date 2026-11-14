import { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacketSink } from './media.js';

// Inputs are disk-backed Files. Only small read caches and interleaved packets
// are resident in memory; the destination is written with backpressure.
export async function remuxFiles(videoFile, audioFile, writer, { signal, onProgress = () => {}, duration = 0 } = {}) {
  const inputs = [];
  const streams = [];
  let output;
  try {
    const videoInput = new Input({ source: new BlobSource(videoFile, { maxCacheSize: 4 * 1024 * 1024 }), formats: ALL_FORMATS });
    inputs.push(videoInput);
    const audioInput = audioFile ? new Input({ source: new BlobSource(audioFile, { maxCacheSize: 2 * 1024 * 1024 }), formats: ALL_FORMATS }) : videoInput;
    if (audioFile) inputs.push(audioInput);
    const video = await videoInput.getPrimaryVideoTrack();
    const audio = await audioInput.getPrimaryAudioTrack();
    if (!video) throw new Error('В потоке не найдена видеодорожка.');
    if (audioFile && !audio) throw new Error('В отдельном потоке не найдена аудиодорожка.');
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 2 }),
      // Keep ownership of the destination: cancel() must not commit a partial file.
      target: new StreamTarget(new WritableStream({
        async write(chunk) { signal?.throwIfAborted(); await writer.write({ type: 'write', position: chunk.position, data: chunk.data }); },
      }), { chunked: true, chunkSize: 1024 * 1024 }),
    });
    for (const track of [video, audio].filter(Boolean)) {
      signal?.throwIfAborted();
      const codec = await track.getCodec();
      const config = await track.getDecoderConfig();
      if (!codec || !config) throw new Error('Кодек этой дорожки пока не поддерживается.');
      const source = track.isVideoTrack() ? new EncodedVideoPacketSource(codec) : new EncodedAudioPacketSource(codec);
      if (track.isVideoTrack()) output.addVideoTrack(source, { rotation: await track.getRotation() });
      else output.addAudioTrack(source);
      const iterator = new EncodedPacketSink(track).packets();
      streams.push({ source, config, iterator, next: await iterator.next(), first: true });
    }
    await output.start();
    for (const stream of streams) if (stream.next.done) stream.source.close();
    while (streams.some(s => !s.next.done)) {
      signal?.throwIfAborted();
      // Preserve decode order within each track while keeping A/V close in time.
      const stream = streams.filter(s => !s.next.done).sort((a, b) => a.next.value.timestamp - b.next.value.timestamp)[0];
      const packet = stream.next.value;
      await stream.source.add(packet, stream.first ? { decoderConfig: stream.config } : undefined);
      stream.first = false;
      onProgress(duration ? Math.min(1, Math.max(0, packet.timestamp / duration)) : 0);
      stream.next = await stream.iterator.next();
      if (stream.next.done) stream.source.close();
    }
    signal?.throwIfAborted();
    await output.finalize();
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    for (const stream of streams) await stream.iterator.return().catch(() => {});
    for (const input of inputs) input.dispose();
  }
}
