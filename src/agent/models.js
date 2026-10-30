// The model ladder, cheapest first. A task says which rung it starts on and how high it may climb, so adding a model
// is one more entry here and no code changes. Names and prices aren't secrets, so they live here and not in .env.
//
// Prices are dollars per 1M tokens, off Together's model page on 2026-10-22. "tools" means the model can call tools,
// which every agent run needs. Kimi K3's card doesn't list tool calling, so it only gets writing jobs.
//
// The ids are our best read of Together's names. Check them against GET /v1/models once the key is in .env, since the
// API names differ from the display names.
export const MODELS =
  [
    { rung: 1, name: "GLM 5.3 Flash", id: "zai-org/GLM-5.3-Flash", priceIn: 0.15, priceOut: 0.5, abilities: ["tools", "json"] },
    { rung: 2, name: "DeepSeek V4.1 Flash 1017", id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", priceIn: 0.3, priceOut: 1.2, abilities: ["tools", "json"] },
    { rung: 3, name: "GLM 5.3", id: "zai-org/GLM-5.3", priceIn: 1.4, priceOut: 4.4, abilities: ["tools", "json"] },
    { rung: 4, name: "Kimi K3", id: "moonshotai/Kimi-K3", priceIn: 3, priceOut: 15, abilities: ["json"] },
  ];
