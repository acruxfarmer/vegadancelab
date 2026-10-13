import {createMediaConnectionSecrets} from './media-connection-secrets.mjs';
import {createMediaConnectionRepository} from './media-connection-repository.mjs';
import {createMediaConnectionWorkflow} from './media-connection-workflow.mjs';
import {createVimeoConnectionAdapter} from './providers/external-media-vimeo.mjs';
import {createYouTubeConnectionAdapter} from './providers/external-media-youtube.mjs';

export const mediaConnectionOrigin='https://vega-development-web.onrender.com';
export const callbackContext={tenantId:'development',businessId:'oauth-callback',provider:'media',purpose:'browser-binding'};
export function createConfiguredMediaConnections(pool,env,{initialOwners=[]}={}){
 if(env.VEGA_MEDIA_CONNECTIONS_ENABLED!=='true')return null;
 if(env.VEGA_ENV!=='development'||env.VEGA_EXTERNAL_EFFECTS!=='disabled'||env.RENDER_SERVICE_ID!=='srv-dao5cjbm8hqs73db51j0')throw Error('Media connections require the approved Development service');
 const secrets=createMediaConnectionSecrets(env.VEGA_MEDIA_CONNECTION_KEY);
 const adapters={};
 if(env.VIMEO_CLIENT_ID&&env.VIMEO_CLIENT_SECRET)adapters.vimeo=createVimeoConnectionAdapter({clientId:env.VIMEO_CLIENT_ID,clientSecret:env.VIMEO_CLIENT_SECRET,redirectUri:mediaConnectionOrigin+'/api/media-connections/vimeo/callback'});
 if(env.YOUTUBE_CLIENT_ID&&env.YOUTUBE_CLIENT_SECRET)adapters.youtube=createYouTubeConnectionAdapter({clientId:env.YOUTUBE_CLIENT_ID,clientSecret:env.YOUTUBE_CLIENT_SECRET,redirectUri:mediaConnectionOrigin+'/api/media-connections/youtube/callback'});
 return {secrets,workflow:createMediaConnectionWorkflow({repository:createMediaConnectionRepository(pool,{initialOwners}),secrets,adapters})};
}
