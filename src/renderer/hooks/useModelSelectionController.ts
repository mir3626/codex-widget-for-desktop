import { useState } from "react";
import type { ModelId, ReasoningEffort } from "../../shared/protocol.js";
import {
  normalizeModelId,
  normalizeReasoningEffort
} from "../../shared/protocol.js";
import {
  MODEL_STORAGE_KEY,
  REASONING_STORAGE_KEY
} from "../config";
import {
  readStoredModel,
  readStoredReasoningEffort
} from "../utils/storage";

export function useModelSelectionController() {
  const [selectedModel, setSelectedModel] = useState<ModelId>(() => readStoredModel());
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(() => readStoredReasoningEffort());

  function updateSelectedModel(value: string) {
    const nextModel = normalizeModelId(value);
    setSelectedModel(nextModel);
    localStorage.setItem(MODEL_STORAGE_KEY, nextModel);
  }

  function updateReasoningEffort(value: string) {
    const nextEffort = normalizeReasoningEffort(value);
    setReasoningEffort(nextEffort);
    localStorage.setItem(REASONING_STORAGE_KEY, nextEffort);
  }

  return {
    selectedModel,
    setSelectedModel,
    reasoningEffort,
    setReasoningEffort,
    updateSelectedModel,
    updateReasoningEffort
  };
}
