// A synchronous lock, independent of React's asynchronous rendering cycle.
export function createOperationGuard() {
 let locked=false;
 return {async run<T>(operation:()=>Promise<T>):Promise<T|undefined>{
  if(locked)return undefined;
  locked=true;
  try{return await operation();}finally{locked=false;}
 }};
}
