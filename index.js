(function() {
	"use strict";
	
	const LocalStorage = new Proxy(window.localStorage,{get: (target,property) => {
		if(property==="get") return async (id) => JSON.parse(target.getItem(id));
		if(property==="set") return async (id,data) => target.setItem(id,JSON.stringify(data));
		if(property==="delete") return async (id) => target.removeItem(id);
		if(property==="count") return async () => target.length;
		return target[property];
	}});
	
	// hand in a Web Storage API compatible local store and remote store, options for server win or local win
	// otherwise wrap local store in versionedstore
	function OffLineFirst(local,remote,options={clear:false}) { // keyPath:"_.#"
		let resolver, rejector, objectstore;
		this.options = {...options};
		this.options.clear = (typeof(options.clear)==="boolean" ? options.clear : false);
		this.local = local || LocalStorage;
		this.remote = remote;
		this.options.futures = (typeof(options.futures)==="number" ? options.futures : 5000);
		this.versionManager = options.versionManager;
		const me = this;
		this.get("OfflineFutureQueue",-1).then(async (queue) => {
			if(queue) {
				const now = Date.now();
				for(let key in queue) {
					const command = queue[key],
						data = command.arguments[1];
						touched = data[this.versionManager.metadataPath()]["@"];
					if(touched<=now) {
						await me[command.apply].apply(this,command.arguments);
					} else {
						setTimeout(async () => {
							await me[command.apply].apply(this,command.arguments);
							queue = await me.get("OfflineFutureQueue",-1);
							delete queue[key];
							await me.set("OfflineFutureQueue",-1);
						},touched - now);
					}
				}
			}
		});
		
		return new Proxy(this,{get: (target,property) => {
			if(typeof(target[property])!=="undefined") {
				return target[property];
			} else {
				return remote[property];
			}
		}});
	}
	OffLineFirst.prototype.clear = async function(locations=0) {
		locations>0 || await this.local.clear();
		if(locations>=0) {
			try {
				await this.remote.clear();
			} catch(e) {
				if(e.message!=="Failed to fetch") {
					throw(e);
				}
			}
		}
	}
	OffLineFirst.prototype.count = async function(locations=0) {
		let count;
		locations>0 || (count = await this.local.count());
		if(locations>=0) {
			try {
				count = await this.remote.count();
			} catch(e) {
				if(e.message!=="Failed to fetch") {
					throw(e);
				}
			}
		}
		return count;
	}
	OffLineFirst.prototype.enqueue = async function(command,args) {
		this.queue || (this.queue = await this.get("OfflineRemoteQueue",-1)) || (this.queue = {});
		this.queue[uuidv4()] = {apply:command,arguments:args};
		await this.set("OfflineRemoteQueue",this.queue,-1);
	}
	OffLineFirst.prototype.delete = async function(id,locations=0) {
		locations>0 || await this.local.delete(id);
		if(locations>=0) {
			try {
				await this.remote.delete(id);
			} catch(e) {
				if(e.message==="Failed to fetch") {
					await this.enqueue("delete",[id,1]); // this will delete the local copy, not good, need to reqork the local/remote seecond are of all commands
				} else {
					throw(e);
				}
			}
		}
	}
	OffLineFirst.prototype.removeItem = OffLineFirst.prototype.delete;
	OffLineFirst.prototype.future = async function(apply,args,delay) {
		queue || (queue = await this.get("OfflineFutureQueue",-1)) || (queue = {});
		const me = this,
			metadatapath = this.versionManager.metadataPath(),
			value = {...data},
			id = uuidv4();
		value[metadatapath] = data[metadatapath];
		queue[id] = {apply,arguments:args};
		await this.set("OfflineFutureQueue",queue,-1);
		setTimeout(async () => {
			const queue = await me.get("OfflineFutureQueue",-1);
			await me[command.apply].apply(me,command.arguments);
			delete queue[id];
			await me.set("OfflineFutureQueue",-1);
		},delay);
	}
	OffLineFirst.prototype.synchronize = async function() {
		const queue = this.queue || (this.queue = await this.get("OfflineRemoteQueue",-1)) || (this.queue = {});
		for(let id in queue) {
			const command = queue[id];
			if(command) {
				await this.remote[command.apply].apply(this,command.arguments);
				delete queue[id];
				await this.set("OfflineRemoteQueue",queue,-1);
			}
		}
		return true;
	}
	OffLineFirst.prototype.get = async function(id,locations=0) {
		const me = this;
		let value = await this.local.get(id);
		if(locations>=0) {
			try {
				this.synchronize();
				const remotevalue = await this.remote.get(id);
				if(value && remotevalue) {
					const now = Date.now(),
						metadata =  remotevalue[this.versionManager.metadataPath()];
					if(metadata) {
						const touched = metadata["@"];
						if(touched>now) {
							await this.future("set",[id,value,-1,true],touched - now);
						} else {
							await this.set(id,this.versionManager.mediate(value,remotevalue),-1);
						}
					}
				}
			} catch(e) {
				if(e.message==="Failed to fetch") {
					await this.enqueue("get",[id]);
				} else {
					throw(e);
				}
			}
		}
		return value;
	}
	OffLineFirst.prototype.getItem = OffLineFirst.prototype.get;
	OffLineFirst.prototype.key = async function(number) {
		return await this.apply("key",[number]);
	}
	OffLineFirst.prototype.put = async function(data,locations=0) {
		const parts = this.versionManager.keyPath().split(".");
		this.versionManager.baseline(data);
		let node = data, id;
		for(let i=0;i<parts.length;i++) {
			const part = parts[i];
			id = node = node[part];
		}
		return this.set(id,data,locations);
	}
	OffLineFirst.prototype.putItem = OffLineFirst.prototype.put;
	OffLineFirst.prototype.set = async function(id,data,locations=0,mediate) {
		if(mediate) {
			await this.versionManager.mediate(data,this.get(id,-1));
		}
		const metadatapath = this.versionManager.metadataPath(),
			value = {...data};
		value[metadatapath] = data[metadatapath];
		locations>0 || await this.local.set(id,value);
		if(locations>=0) {
			try {
				this.synchronize();
				await this.remote.set(id,value);
			} catch(e) {
				if(e.message==="Failed to fetch") {
					await this.enqueue("set",[id,value,1]);
				} else {
					throw(e);
				}
			}
		}
	}
	OffLineFirst.prototype.setItem = OffLineFirst.prototype.set;

	window.OffLineFirst = OffLineFirst;	
}).call(this);