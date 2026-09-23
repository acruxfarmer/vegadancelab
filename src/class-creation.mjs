import {classDetails} from './class-details.mjs';

// The canonical construction and activity path for every newly created class.
export function createClass(state,body,authority,{id,now},fail){
 const result={...classDetails(body,fail),id:id(),status:'open'};
 state.classes.push(result);
 state.activity.push({id:id(),action:'class',actorId:authority.userId,subjectId:result.id,createdAt:now()});
 return result;
}
