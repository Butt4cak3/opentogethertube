import Vue from 'vue';
import Vuex from 'vuex';
import _ from 'lodash';
import { API } from './common-http.js';
import moment from 'moment';

Vue.use(Vuex);

export default new Vuex.Store({
	state: {
		playerStatus: null,
		playerBufferPercent: null,
		playerBufferSpans: null,
		fullscreen: false,
		socket: {
			isConnected: false,
			message: '',
			reconnectError: false,
		},
		joinFailureReason: null,
		production: process.env.NODE_ENV === 'production',
		/** Unregistered user's username  */
		username: null,
		/** Registered user */
		user: null,
		/** Current user's role */
		yourRole: 0,
		room: {
			name: "",
			title: "",
			description: "",
			isTemporary: false,
			queueMode: "manual",
			currentSource: {},
			queue: [],
			isPlaying: false,
			playbackPosition: 0,
			hasOwner: false,
			grants: 0,
			chatMessages: [],
			events: [],
		},

		// used for prompting the user if they want to add the video they came from or the video linked to the queue
		quickAdd: [],

		keepAliveInterval: null,
		/** Permissions metadata */
		permsMeta: {
			loaded: false,
			roles: {},
			permissions: [],
		},
	},
	mutations:{
		SOCKET_ONOPEN (state, event)  {
			console.log("socket open");
			state.joinFailureReason = null;
			Vue.prototype.$socket = event.currentTarget;
			state.socket.isConnected = true;
			state.room.chatMessages = [];
			state.room.events = [];
			let username = window.localStorage.getItem("username"); // no longer used, eventually can be removed
			if (!state.user && username) {
				window.localStorage.removeItem('username');
				state.username = username;
				API.post("/user", { username });
			}
			if (state.keepAliveInterval) {
				clearInterval(state.keepAliveInterval);
				state.keepAliveInterval = null;
			}
			state.keepAliveInterval = setInterval(() => {
				Vue.prototype.$socket.sendObj({"action":"ping"});
			}, 25000);
		},
		SOCKET_ONCLOSE (state, event)  {
			console.log("socket close", event);
			state.socket.isConnected = false;
			if (event.code === 4002) {
				state.joinFailureReason = "Room does not exist.";
				Vue.prototype.$disconnect();
				Vue.prototype.$events.fire("roomJoinFailure", { reason: "Room does not exist." });
			}
			if (state.keepAliveInterval) {
				clearInterval(state.keepAliveInterval);
				state.keepAliveInterval = null;
			}
		},
		SOCKET_ONERROR (state, event)  {
			console.error(state, event);
		},
		// default handler called for all methods
		SOCKET_ONMESSAGE (state, message)  {
			console.log("socket message");
			state.socket.message = message;
		},
		// mutations for reconnect methods
		SOCKET_RECONNECT(state, count) {
			console.info("reconnect", state, count);
		},
		SOCKET_RECONNECT_ERROR(state) {
			state.socket.reconnectError = true;
		},
		PLAYBACK_STATUS(state, message) {
			state.playerStatus = message;
			Vue.prototype.$socket.sendObj({ action: "status", status: message });
		},
		PLAYBACK_BUFFER(state, percent) {
			state.playerBufferPercent = percent;
		},
		PLAYBACK_BUFFER_SPANS(state, spans) {
			state.playerBufferSpans = spans;
		},
		LOGIN(state, user) {
			state.user = user;
		},
		LOGOUT(state) {
			state.user = null;
		},
		QUICKADD_ADD(state, video) {
			state.quickAdd.push(video);
		},
		QUICKADD_CLEAR(state) {
			state.quickAdd = [];
		},
		PERMISSIONS_METADATA(state, metadata) {
			for (let role of metadata.roles) {
				state.permsMeta.roles[role.id] = role;
			}
			state.permsMeta.permissions = metadata.permissions;
			state.permsMeta.loaded = true;
		},
	},
	actions: {
		sendMessage(context, message) {
			Vue.prototype.$socket.send(message);
		},
		sync(context, message) {
			console.debug("SYNC", message);
			delete message.action;
			if (message.isPlaying !== undefined && this.state.room.isPlaying !== message.isPlaying) {
				Vue.prototype.$events.emit(message.isPlaying ? "playVideo" : "pauseVideo");
			}
			if (message.playbackPosition !== undefined) {
				console.log("setting playback start time");
				this.state.room.playbackStartTime = moment();
			}
			// HACK: this lets vue detect the changes and react to them
			// https://vuejs.org/v2/guide/reactivity.html#Change-Detection-Caveats
			this.state.room = Object.assign({}, this.state.room, message);

			if (!this.user) {
				let you = _.find(this.state.room.users, { isYou: true });
				this.state.username = you.name;
				this.state.yourRole = you.role;
			}

			Vue.prototype.$events.emit('onSync');
		},
		chat(context, message) {
			this.state.room.chatMessages.push(message);
		},
		event(context, message) {
			let event = message.event;
			event.isVisible = true;
			event.isUndoable = event.eventType === 'seek' || event.eventType === 'skip' || (event.eventType === 'addToQueue' && event.parameters.video) || event.eventType === 'removeFromQueue';
			event.timeout = event.isUndoable ? 7000 : 4000;
			if (event.eventType === 'seek' && this.state.room.events.slice(-1)[0].eventType === 'seek' && this.state.room.events.slice(-1)[0].isVisible) {
				this.state.room.events[this.state.room.events.length - 1].parameters.position = event.parameters.position;
				this.state.room.events[this.state.room.events.length - 1].timeout += 1;
			}
			else {
				this.state.room.events.push(event);
			}
			Vue.prototype.$events.emit('onRoomEvent', message.event);
		},
		announcement(context, message) {
			Vue.prototype.$events.emit('onAnnouncement', message.text);
		},
		error(context, message) {
			console.log(`Server sent error: ${message.error}`);
			Vue.prototype.$events.emit('notify_onError', { message: message.error });
		},
		async updatePermissionsMetadata(context) {
			if (context.state.permsMeta.loaded) {
				return;
			}
			let resp = await API.get("/data/permissions");
			let meta = resp.data;
			context.commit("PERMISSIONS_METADATA", meta);
		},
	},
});
