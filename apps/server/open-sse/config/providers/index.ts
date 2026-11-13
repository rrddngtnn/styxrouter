import {augmentApiProvider} from './registry/augment-api/index.ts';
import type { RegistryEntry } from "./shared.ts";

import { anthropicProvider } from "./registry/anthropic/index.ts";
import { glmProvider } from "./registry/glm/index.ts";
import { glmtProvider } from "./registry/glm/t/index.ts";
import { lmarenaProvider } from "./registry/lmarena/index.ts";
import { githubProvider } from "./registry/github/index.ts";
import { claudeProvider } from "./registry/claude/index.ts";
import { claude_webProvider } from "./registry/claude/web/index.ts";
import { qoderProvider } from "./registry/qoder/index.ts";
import { kimi_coding_apikeyProvider } from "./registry/kimi/coding-apikey/index.ts";
import { kimi_codingProvider } from "./registry/kimi/coding/index.ts";
import { kimiProvider } from "./registry/kimi/index.ts";
import { kimi_webProvider } from "./registry/kimi/web/index.ts";
import { nvidiaProvider } from "./registry/nvidia/index.ts";
import { antigravityProvider } from "./registry/antigravity/index.ts";
import { openaiProvider } from "./registry/openai/index.ts";
import { qwen_cloudProvider } from "./registry/qwen-cloud/index.ts";
import { kieProvider } from "./registry/kie/index.ts";
import { moonshotProvider } from "./registry/moonshot/index.ts";
import { poeProvider } from "./registry/poe/index.ts";
import { minimaxProvider } from "./registry/minimax/index.ts";
import { minimax_cnProvider } from "./registry/minimax/cn/index.ts";
import { chatgpt_web_codexProvider } from "./registry/chatgpt-web-codex/index.ts";
import { openrouterProvider } from "./registry/openrouter/index.ts";
import { cheaperinferenceProvider } from "./registry/cheaperinference/index.ts";
import { aihordeProvider } from "./registry/aihorde/index.ts";
import { xaiProvider, xai_oauthProvider } from "./registry/xai/index.ts";
import { zcodeProvider } from "./registry/zcode/index.ts";
import { alibabaProvider } from "./registry/alibaba/index.ts";
import { alibaba_cnProvider } from "./registry/alibaba/cn/index.ts";
import { bailian_coding_planProvider } from "./registry/bailian-coding-plan/index.ts";
import { auggieProvider } from "./registry/auggie/index.ts";
import { opencode_zenProvider } from "./registry/opencode/zen/index.ts";
import { opencode_goProvider } from "./registry/opencode/go/index.ts";
import { opencodeProvider } from "./registry/opencode/index.ts";
import { geminiProvider } from "./registry/gemini/index.ts";
import { gemini_webProvider } from "./registry/gemini/web/index.ts";
import { codexProvider } from "./registry/codex/index.ts";
import { codexAppServerProvider } from "./registry/codex-app-server/index.ts";
import { kiroProvider } from "./registry/kiro/index.ts";
import { codebuddy_cnProvider } from "./registry/codebuddy-cn/index.ts";
import { codebuddy_intlProvider } from "./registry/codebuddy-intl/index.ts";
import { promptqlProvider } from "./registry/promptql/index.ts";
import { muse_codeProvider } from "./registry/muse-code/index.ts";

export const REGISTRY: Record<string, RegistryEntry> = {
  anthropic: anthropicProvider,
  glm: glmProvider,
  glmt: glmtProvider,
  lmarena: lmarenaProvider,
  github: githubProvider,
  // Vendor-level alias: GitHub is the OAuth platform, Copilot the product
  "github-copilot": githubProvider,
  claude: claudeProvider,
  // Vendor-level alias: Anthropic is the vendor, Claude the model line
  "anthropic-oauth": claudeProvider,
  "claude-web": claude_webProvider,
  qoder: qoderProvider,
  "kimi-coding-apikey": kimi_coding_apikeyProvider,
  "kimi-coding": kimi_codingProvider,
  kimi: kimiProvider,
  "kimi-web": kimi_webProvider,
  nvidia: nvidiaProvider,
  antigravity: antigravityProvider,
  openai: openaiProvider,
  "qwen-cloud": qwen_cloudProvider,
  kie: kieProvider,
  moonshot: moonshotProvider,
  poe: poeProvider,
  minimax: minimaxProvider,
  "minimax-cn": minimax_cnProvider,
  "chatgpt-web-codex": chatgpt_web_codexProvider,
  openrouter: openrouterProvider,
  cheaperinference: cheaperinferenceProvider,
  aihorde: aihordeProvider,
  xai: xaiProvider,
  "xai-oauth": xai_oauthProvider,
  zcode: zcodeProvider,
  // zai merged into glm (SCOPE vendor-naming refactor): Z.ai is the vendor,
  // GLM the model family. GlmExecutor serves both transports (openai primary,
  // anthropic fallback + providerSpecificData.primaryTransport override), so the
  // standalone zai DefaultExecutor+anthropic entry was pure duplication.
  zai: glmProvider,
  alibaba: alibabaProvider,
  "alibaba-cn": alibaba_cnProvider,
  "bailian-coding-plan": bailian_coding_planProvider,
  "augment-api": augmentApiProvider,
  auggie: auggieProvider,
  "opencode-zen": opencode_zenProvider,
  "opencode-go": opencode_goProvider,
  opencode: opencodeProvider,
  gemini: geminiProvider,
  // Vendor-level alias: Google is the vendor, Gemini the model
  "google-gemini": geminiProvider,
  "gemini-web": gemini_webProvider,
  codex: codexProvider,
  // Vendor-level alias: OpenAI is the vendor, Codex the legacy product
  "openai-codex": codexProvider,
  "codex-app-server": codexAppServerProvider,
  kiro: kiroProvider,
  "codebuddy-cn": codebuddy_cnProvider,
  "codebuddy-intl": codebuddy_intlProvider,
  promptql: promptqlProvider,
  "muse-code": muse_codeProvider,
};
