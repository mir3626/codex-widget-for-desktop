import { MockAsrEngine, SidecarAsrEngine } from "./asrEngine.js";
import { decodeAsrCommand, type AsrDecoderContext } from "./deterministicDecoder.js";
import type { AsrEngine, AsrEngineInput, Transcript } from "./types.js";

export class AsrRouter {
  constructor(private readonly engines: AsrEngine[] = [new SidecarAsrEngine(), new MockAsrEngine()]) {}

  async transcribe(input: AsrEngineInput): Promise<Transcript> {
    for (const engine of this.engines) {
      if (await engine.isAvailable()) {
        return engine.transcribe(input);
      }
    }
    throw new Error("No ASR engine is available.");
  }

  async transcribeAndDecode(input: AsrEngineInput & { decoderContext?: AsrDecoderContext }) {
    const transcript = await this.transcribe(input);
    return {
      transcript,
      decode: decodeAsrCommand(transcript, input.decoderContext ?? { uiLabels: input.hints })
    };
  }
}
