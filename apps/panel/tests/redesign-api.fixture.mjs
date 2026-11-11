export const analytics={range:'7d',summary:{totalRequests:24,promptTokens:1200,completionTokens:800,totalTokens:2000,uniqueModels:1,uniqueAccounts:1,successfulRequests:23,successRatePct:95.83,avgLatencyMs:320,totalCost:.02},dailyTrend:[{date:'2026-11-10',requests:10,promptTokens:500,completionTokens:300,totalTokens:800,cost:.01},{date:'2026-11-11',requests:14,promptTokens:700,completionTokens:500,totalTokens:1200,cost:.01}],byModel:[{provider:'openai',model:'openai/fixture-model',requests:24,totalTokens:2000,cost:.02,avgLatencyMs:320,successRatePct:95.83}],byProvider:[{provider:'openai',providerId:'openai',requests:24,totalTokens:2000,cost:.02,avgLatencyMs:320,successRatePct:95.83}],byAccount:[],byApiKey:[],errorBreakdown:[]};
export const account={id:'synthetic-account',provider:'openai',name:'Synthetic QA account',authType:'apikey',isActive:true,testStatus:null,lastError:null,backoffLevel:0,rateLimitedUntil:null,tokenExpiresAt:null};
export const known={
 '/api/auth/status':{authenticated:true},'/api/health/ping':{ok:true,uptime_seconds:100},
 '/api/providers':{providers:[{id:'openai',name:'OpenAI · synthetic fixture',authModes:['apikey'],vendor:'OpenAI'}]},
 '/api/connections':{connections:[account]},'/api/provider-nodes':{nodes:[]},'/api/oauth/providers':{providers:[]},
 '/api/usage/analytics':analytics,'/api/usage/call-logs':[],
 '/api/keys':{keys:[]},'/api/settings':{},'/api/routing/combos':{combos:[]},'/api/routing/trace':{entries:[],traces:[]},
 '/api/usage/quota':{providers:[{provider:'openai',connectionId:account.id,name:account.name,isActive:true,quotaSupported:false,quotaUsed:0,quotaTotal:null,percentRemaining:null,resetAt:null,tokenStatus:'unknown',windows:[]}]},
 '/api/quota/pools':{pools:[],total:0},'/api/audit-log':{entries:[],total:0},'/api/backups':{backups:[]},
 '/api/webhooks':{webhooks:[]},'/api/proxies/config':{global:null,providers:{},connections:{}},
 '/v1/models':{data:[{id:'openai/fixture-model',owned_by:'openai',type:'chat'}]},
 '/api/admin/provider-catalog':{data:[]},
 '/api/providers/openai/models':{providerId:'openai',prefix:'openai',catalogStatus:'known',models:[{id:'fixture-model',name:'Synthetic fixture model',type:'chat',origin:'built-in'}]},
 '/api/connections/import/providers':{providers:[]},'/api/model-metadata':{model:{provider:'openai',modelId:'fixture-model',contextWindow:4096,overrides:{}}},
 '/api/admin/env':{values:{},allowedKeys:[]},'/api/process-health/start':{startedAt:null},'/api/process-health/peak':{peakRssBytes:null},'/api/process-health/cpu':{userMicroseconds:0,systemMicroseconds:0},'/api/process-health/threads':{threadCount:null},'/api/process-health/token-scheduler':{},'/api/process-health/dispatch':{providers:[]},'/api/storage-health':{databaseBytes:null,walBytes:null},'/api/storage-health/vacuum':{lastSuccessfulSchedulerVacuumAt:null},
 '/api/versions/zcode/status':{},'/api/versions/antigravity/ide/status':{},'/api/versions/antigravity/cli/status':{},
};
