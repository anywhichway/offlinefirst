(function() {
	"use strict";

	function OffLineFirst(name,remote,options={clear:false}) {
		let resolver, rejector, objectstore;
		this.location = remote || null;
		this.opened = new Promise((resolve,reject) => { resolver = resolve; rejector = reject;});
		const me = this,
			request = indexedDB.open(name);
		request.onupgradeneeded = (event) => {
			me.indexed = event.target.result;
			objectstore = me.indexed.createObjectStore("keyvaluepairs", { keyPath: "id" });
		}
		request.onsuccess = (event) => {
			if(objectstore) {
				objectstore.transaction.complete = (event) => {
					if(options.clear) {
						me.clear().then(() => {
							resolver();
						})
					} else {
						resolver();
					}	
				}
			} else {
				me.indexed = event.target.result;
				if(options.clear) {
					me.clear().then(() => {
						resolver();
					})
				} else {
					resolver();
				}
			}
		}
		return new Proxy(this,{get: (target,property) => {
			if(typeof(target[property])!=="undefined") {
				return target[property];
			} else {
				return async function() {
					return target.apply(property,[].slice.call(arguments));
				}
			}
		}});
	}
	OffLineFirst.prototype.apply = async function(name,args=[]) {
		return this.fetch(this.location+"/"+name,{method:"POST",body:args})
	}
	OffLineFirst.prototype.clear = async function(local) {
		local || (local = (this.location==null));
		const me = this;
		return new Promise((resolve,reject) => {
			const transaction = me.indexed.transaction(["keyvaluepairs"],"readwrite"),
				objectstore = transaction.objectStore("keyvaluepairs"),
				request = objectstore.clear();
			request.onsuccess = () => {
				if(!local) {
					me.fetch(me.location+"/clear",{method:"POST"})
						.then(() => {
							resolve();
						})
						.catch((e) => {
							if(e instanceof TypeError) {
								resolve();
							} else {
								throw(e);
							}
						});
				} else {
					resolve();
				}
			}
		});
	}
	OffLineFirst.prototype.count = async function(local) {
		local || (local = (this.location==null));
		const me = this;
		return new Promise((resolve,reject) => {
			const transaction = me.indexed.transaction(["keyvaluepairs"],"readwrite"),
				objectstore = transaction.objectStore("keyvaluepairs"),
				request = objectstore.count();
			request.onsuccess = () => {
				let result = request.result;
				if(!local) {
					me.fetch(me.location+"/count",{method:"POST"})
						.then(async (response) => {
							if(response.status===200) {
								try {
									result = await response.json();
								} catch(e) { // result is undefined
									;
								}
							}
							resolve(result);
						})
						.catch((e) => {
							if(e instanceof TypeError) {
								resolve(result);
							} else {
								throw(e);
							}
						});
				} else {
					resolve(result);
				}
			}
		});
	}
	OffLineFirst.prototype.delete = async function(id,local) {
		local || (local = (this.location==null));
		const me = this;
		return new Promise((resolve,reject) => {
			const transaction = me.indexed.transaction(["keyvaluepairs"],"readwrite"),
				objectstore = transaction.objectStore("keyvaluepairs"),
				request = objectstore.count();
			request.onsuccess = () => {
				if(!local) {
					fetch(me.location+"/"+id,{method:"DELETE"})
						.then(() => {
							resolve();
						})
						.catch((e) => {
							if(e instanceof TypeError) {
								resolve();
							} else {
								throw(e);
							}
						})
				} else {
					resolve();
				}	
			}
			request.onerror = () => {
				if(!local) {
					fetch(me.location+"/"+id,{method:"DELETE"})
						.then(() => {
							resolve();
						})
						.catch((e) => {
							if(e instanceof TypeError) {
								resolve();
							} else {
								throw(e);
							}
						})
				} else {
					resolve();
				}
			}
		})
	}
	OffLineFirst.prototype.removeItem = OffLineFirst.prototype.delete;
	OffLineFirst.prototype.fetch = async function(url,options) {
		const me = this;
		me.processQueue();
		return fetch(url,options).then((response) => {
			return response;
		}).catch((e) => {
			if(e instanceof TypeError) {
				me.queue || (me.queue = []);
				me.queue.push({url,options});
				me.set("OfflineFirstQueue",me.queue,true);
			}
			throw e;
		})
	}
	OffLineFirst.prototype.processQueue = async function() {
		let queue = await this.get("OfflineFirstQueue",true);
		queue || (queue = []);
		this.queue = queue;
		for(let command of queue) {
			try {
				await fetch(command.url,command.options);
				queue.shift();
				await this.set("OfflineFirstQueue",queue,true);
			} catch(e) {
				if(e instanceof TypeError) {
					return;
				}
				throw(e);
			}
		}
	}
	OffLineFirst.prototype.get = async function(id,local) {
		local || (local = (this.location==null));
		const me = this;
		return this.opened.then(() => {
			return new Promise((resolve,reject) => {
				const promise = (local ? Promise.reject(new TypeError()) : this.fetch(this.location+"/"+id,{method:"GET"}))
				return promise.then(async (response) => {
						if(response.status===200) {
							let result;
							try {
								result = await response.json();
							} catch(e) { // result is undefined
								//await me.delete(id,true);
								resolve();
								return;
							}
							// add to local database
							await me.set(id,result,true);
							resolve(result);
						} else {
							throw new TypeError(response.status);
						}
					})
					.catch((e) => { 
						if(e instanceof TypeError) {
							const transaction = this.indexed.transaction(["keyvaluepairs"],"readwrite"),
								objectstore = transaction.objectStore("keyvaluepairs"),
								request = objectstore.get(id);
							request.onsuccess = (event) => {
								resolve(event.target.result.data);	
							}
							request.onerror = (event) => {
								reject(JSON.stringify(event));
							}
						} else {
							reject(e);
						}
					});
			});
		});
	}
	OffLineFirst.prototype.getItem = OffLineFirst.prototype.get;
	OffLineFirst.prototype.key = async function(number) {
		return await this.apply("key",[number]);
	}
	OffLineFirst.prototype.set = async function(id,data,local) {
		local || (local = (this.location==null));
		const me = this;
		return this.opened.then(() => {
			return new Promise((resolve,reject) => {
				const transaction = me.indexed.transaction(["keyvaluepairs"],"readwrite"),
					objectstore = transaction.objectStore("keyvaluepairs"),
					request = objectstore.put({id,data});
				request.onsuccess = (event) => {
					if(local) {
						resolve();
					} else {
						return me.fetch(me.location+"/"+id,{method:"PUT",body:data})
							.then(() => resolve())
							.catch((e) => { 
								if(e instanceof TypeError) {
									resolve();
								} else {
									reject(e);
								}
							})
					}	
				}
				request.onerror = (event) => {
					reject(JSON.stringify(event));
				}
			});
		});
	}
	OffLineFirst.prototype.setItem = OffLineFirst.prototype.set;

	window.OffLineFirst = OffLineFirst;	
}).call(this);