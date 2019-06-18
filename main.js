/* jshint -W097 */
/* jshint strict:false */
/* global require */
/* global RRule */
/* global __dirname */
/* jslint node: true */

//adapter.config.devicetype.toLowerCase(); --> "server" (eNet Geräteart ist Server) (String) 
//adapter.config.devicetype.toLowerCase(); --> "gateway" (eNet Geräteart ist Gateway) (String)
//adapter.config.ip --> IP des Gateways oder Servers (String)
//adapter.config.username --> Benutzername für den eNet Server (wird bei Gateway nicht genutzt) (String)
//adapter.config.password --> Passwort für den eNet Server (wird bei Gateway nicht benutzt) (String)
//adapter.config.interval --> Poll Intervall für aktuelle Zustände/States (wird bei Server nicht genutzt) (Integer)
//adapter.config.syncroomsandscenes --> Räume und Szenen einmalig vom Gateway abrufen ja/nein (wird bei Server nicht genutzt) (Boolean)

"use strict";
var utils = require('@iobroker/adapter-core');
var adapter;
var eNet = require(__dirname + "/lib/enet");
var Gateway = require(__dirname + "/lib/gateway");
var pollTimerStates = null;
var SyncRoomsAndScenes = false;
var eNetType = "Server";

var http = require('http');
var crypto = require('crypto');

function startAdapter(options) {
    options = options || {};
    Object.assign(options,{
        name:  "enet",
        stateChange:  function (id, state) 
		{
			eNetType = adapter.config.devicetype;
			if (eNetType == "Gateway")
			{
				var eNetChannelArray = id.split(".");
				var eNetChannelTemp = eNetChannelArray[2];
				if (eNetChannelTemp.search(/channel/g));
				{
					var eNetChannel = eNetChannelTemp.replace("channel", "");
					if (state && !state.ack)
						setGatewayChannel(adapter.config.ip, id, eNetChannel, state.val);
				}
			}
			else if (eNetType == "Server")
			{
			}
		},
        unload: function (callback) 
		{
			try 
			{
				eNetType = adapter.config.devicetype;		
				if (eNetType == "Gateway")
				{
					clearInterval(pollTimerStates);
					pollTimerStates = null;				
				}
				else if (eNetType == "Server")
				{
				}
				adapter.setState("info.connection", false, true);
				callback();
			} 
			catch (e) 
			{
				callback();
			}			
        },
        ready: function () 
		{
			eNetType = adapter.config.devicetype;
			if (eNetType == "Gateway")
			{
				adapter.log.info("Running eNet Adapter Version " + adapter.version + ", Configured eNet Gateway: " + adapter.config.ip);
			}
			else if (eNetType == "Server")
			{
				adapter.log.info("Running eNet Adapter Version " + adapter.version + ", Configured eNet Server: " + adapter.config.ip + ", Username: " + adapter.config.username);
			}
			init();			
            main();
        }
    });
    adapter = new utils.Adapter(options);
    return adapter;
}			

function init() 
{
	if (adapter.config.ip)
	{
		eNetType = adapter.config.devicetype;
		if (eNetType == "Gateway")
		{
			getGatewayDevices(adapter.config.ip)
		}
		else if (eNetType == "Server")
		{
			adapter.log.debug("INIT SERVER");
		}
	}
}

function main() 
{
	adapter.subscribeStates("*");
	if (parseInt(adapter.config.interval, 10))
	{
		eNetType = adapter.config.devicetype;
		if (eNetType == "Gateway")
		{
			pollTimerStates = setInterval(getGatewayStates, parseInt(adapter.config.interval, 10));
		}
		else if (eNetType == "Server")
		{
			adapter.log.debug("MAIN SERVER");
		}
	}
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///																																											//
///          BEGIN ENET SERVER ROUTINES 																																	//
///																																											//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////













//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///																																											//
///          BEGIN ENET GATEWAY ROUTINES 																																	//
///																																											//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function deleteGatewayStates(states, callback) 
{
	if (!states || !states.length) 
	{
		if (callback) callback();
		return;
	}
	
	eNetType = adapter.config.devicetype;
	if (eNetType == "Gateway")
	{
		var id = states.pop();
		adapter.delObject(id, function (err) 
		{
			adapter.delState(id, function (err) 
			{
			});         
		});
	}
	else if (eNetType == "Server")
	{
		adapter.log.debug("DELETE STATES SERVER");
	}
};

function getGatewayStates()
{
	// Channel subscription -> write state to ioBroker if channel changes
	adapter.log.debug("getGatewayStates: Starting to retrieve the current states from eNet gateway");

	adapter.getState("gateway.subscribeable_channels", function (err, state) 
	{
        if (state)
		{
			var eNetChannelList;
			eNetChannelList = JSON.parse(state.val);
			adapter.log.debug("getGatewayStates: Array of subscribeable Channels: " + eNetChannelList.toString());
			
			var Gateway = eNet.gateway({host: adapter.config.ip});
			Gateway.connect();
			Gateway.signIn(eNetChannelList, function(err, res)
			{
				if (err) 
				{
					adapter.log.error("getGatewayStates: Error on signing in channels for subscription: " + err);
					adapter.setState("info.connection", false, true)
				}
				if (res) 
				{
					adapter.log.debug.log("getGatewayStates: Sucess in singing in to channels: " + JSON.stringify(res));
					adapter.setState("info.connection", true, true);
				}
			});

			for(var y = 0; y < eNetChannelList.length; y++) 
			{
				Gateway.on(eNetChannelList[parseInt(y)], function(err, msg) 
				{
					if (!err && msg) 
					{	
						var ResponseString = JSON.stringify(msg)
						var ParsedJSON = JSON.parse(ResponseString);
						if (ParsedJSON)
						{
							var eNetChannel = ParsedJSON.NUMBER;
							adapter.getState("channel" + eNetChannel.toString() + ".STATE", function (err, state) 
							{
								if (state)
								{
									var eNetValue = ParsedJSON.STATE;
									adapter.log.debug("getGatewayStates: (channel" + eNetChannel.toString() + ".STATE) Channel: " + eNetChannel.toString() + ", Value: " + eNetValue.toString() + ", State: " + ParsedJSON.STATE + ", Setpoint: " + ParsedJSON.SETPOINT + ", Data for channel: " + JSON.stringify(msg));
									var ActualValue = state.val;
									if ((eNetValue == "OFF") || (eNetValue == -1))
										eNetValue = false;
									else eNetValue = true;
									if (ActualValue != eNetValue)
									{
										adapter.log.debug("getGatewayStates: Setting state for channel: " + eNetChannel.toString() + " to ioBroker objects DB Old Value: " + ActualValue + " new Value: " + eNetValue);
										adapter.setState("channel" + eNetChannel.toString() + ".STATE", eNetValue, true);
									}
								}
							});						
							
							adapter.getState("channel" + eNetChannel.toString() + ".LEVEL", function (err, state) 
							{
								if (state)
								{
									var eNetValue = ParsedJSON.VALUE;
									adapter.log.debug("getGatewayStates: (channel" + eNetChannel.toString() + ".LEVEL) Channel: " + eNetChannel.toString() + ", Value: " + eNetValue.toString() + ", State: " + ParsedJSON.STATE + ", Setpoint: " + ParsedJSON.SETPOINT + ", Data for channel: " + JSON.stringify(msg));
									var ActualValue = state.val;
									if (eNetValue == -1)
										eNetValue = 0;
									if (ActualValue != eNetValue)
									{
										adapter.log.debug("getGatewayStates: Setting state for channel: " + eNetChannel.toString() + " to ioBroker objects DB Old Value: " + ActualValue + " new Value: " + eNetValue);
										adapter.setState("channel" + eNetChannel.toString() + ".LEVEL", eNetValue.toString(), true);
									}
								}
							});								
						}
						else adapter.log.error("getGatewayStates: Parse JSON Error: " + err);
					}
					else adapter.log.error("getGatewayStates: Gateway.on Error: " + err);
					Gateway.disconnect();
				});
			}
		}
	});
};
	
function getGatewayDevices(ip)
{
	if (adapter.config.ip)
	{
		SyncRoomsAndScenes = adapter.config.sync_roomsandscenes;
		if (SyncRoomsAndScenes)
		{
			adapter.getStates(adapter.namespace + ".rooms.*", function (err, states) 
			{
				var toDelete = [];
				for (var id in states) 
					toDelete.push(id);
				deleteGatewayStates(toDelete, function() 
				{
				});
			});

			adapter.getStates(adapter.namespace + ".scenes.*", function (err, states) 
			{
				var toDelete = [];
				for (var id in states) 
					toDelete.push(id);
				deleteGatewayStates(toDelete, function() 
				{
				});
			});
		}

		var gw = eNet.gateway({host: adapter.config.ip});
		gw.connect();
		adapter.log.debug("getGatewayDevices: Getting gateway devices...");
		var DeviceList = {};
		gw.getProjectList(function(err, res)
		{
			if (err) 
				adapter.log.error("getGatewayDevices: Error getting eNet Gateway devices: " + err);
			else 
			{
				adapter.log.debug("getGatewayDevices: Connected to eNet Gateway for device setup: " + JSON.stringify(res));
				adapter.setState("info.connection", true, true);
				setupGatewayDevices(gw, JSON.stringify(res));
			}
			gw.disconnect();
		})
	}
};

function setupGatewayDevices(gw, res)
{
	// 0 to 15: Scenes
	// 16 to 41: Channel/Device 1 to 24
	// 42 to 43: All on/off and Master Dim
	var gw = eNet.gateway({host: adapter.config.ip});
	gw.connect();
	gw.getVersion(function(err, res) 
	{
		if (err) 
			adapter.log.error("setupGatewayDevices: Error getting eNet Gateway version: " + err);
		else 
		{
			adapter.setState("info.connection", true, true);
			var ParsedJSON = JSON.parse(JSON.stringify(res));
			if (ParsedJSON)
			{
				adapter.log.info("ioBroker Jung/Gira eNet Adapter Version " + adapter.version + ". Connected to eNet Gateway on " + gw.name + ", Gateway Firmware: " + ParsedJSON.FIRMWARE + ", Gateway Hardware: " + ParsedJSON.HARDWARE + ", Protocol: " + ParsedJSON.PROTOCOL + ", eNet: " + ParsedJSON.ENET);
			}
		}
		gw.disconnect();
	})	
	
	var ParsedJSON = JSON.parse(res);
	if (ParsedJSON)
	{
		adapter.log.debug("setupGatewayDevices: Got JSON device information from eNet gateway. Count of Devices: " + ParsedJSON.ITEMS.length + ", " + "Count of rooms: " + ParsedJSON.LISTS.length);
		var DevicesCount = ParsedJSON.ITEMS.length;
		var RoomsCount = ParsedJSON.LISTS.length;

		// Setting up devices/channels
		adapter.log.debug("setupGatewayDevices: Reading Scenes/Channels/Devices...");
		var channelArray = [];
		for (var x = 0; x < DevicesCount; x++) 
		{
			var JSONDeviceType = ParsedJSON.ITEMS[x].TYPE;
			var DeviceType = JSONDeviceType.toUpperCase();
			switch(DeviceType)
			{
				case "SCENE":
					if (SyncRoomsAndScenes === true)
					{
						adapter.setObjectNotExists("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER, {
						_id : adapter.namespace + "scenes.scene" + ParsedJSON.ITEMS[x].NUMBER,
						type: "channel",
						common: {
							name: ParsedJSON.ITEMS[x].NAME,
						},
						native: {}
						});
					
						adapter.setObjectNotExists("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
						_id : adapter.namespace + "scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".ID",
						type: "state",
							common: {
							name: ParsedJSON.ITEMS[x].NAME + ":ID",
							type: "string",
							role: "id",
							write: "false",
							read: "true"
						},
						native: {}
						});	
			
						adapter.setObjectNotExists("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
						_id : adapter.namespace + "scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".NAME",
						type: "state",
							common: {
							name: ParsedJSON.ITEMS[x].NAME + ":NAME",
							type: "string",
							role: "value",
							write: "false",
							read: "true"
						},
						native: {}
						});								
			
						if (ParsedJSON.ITEMS[x].DIMMABLE)
						{
							adapter.setObjectNotExists("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", {
							_id : adapter.namespace + "scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL",
							type: "state",
								common: {
								name: ParsedJSON.ITEMS[x].NAME + ":LEVEL",
								type: "number",
								role: "level.dimmer",
								min: 0,
								max: 100
							},
							native: {}
							});							
						}
						else
						{
							adapter.setObjectNotExists("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".STATE", {
							_id : adapter.namespace + "scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".STATE",
							type: "state",
								common: {
								name: ParsedJSON.ITEMS[x].NAME + ":STATE",
								type: "boolean",
								role: "scene.state"
							},
							native: {}
							});
						}
						
						adapter.setState("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
						adapter.setState("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
						adapter.setState("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".STATE", false, true);
						adapter.log.debug("setupGatewayDevices: Added Scene ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);						
					}
				break;
				
				case "BINAER":
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER, {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER,
					type: "channel",
					common: {
						name: ParsedJSON.ITEMS[x].NAME,
					},
					native: {}
					});
					
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID",
					type: "state",
						common: {
						name: ParsedJSON.ITEMS[x].NAME + ":ID",
						type: "string",
						role: "id",
						write: "false",
						read: "true"
					},
					native: {}
					});	
			
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME",
					type: "state",
						common: {
							name: ParsedJSON.ITEMS[x].NAME + ":NAME",
							type: "string",
							role: "value",
							write: "false",
							read: "true"
						},
					native: {}
					});								
			
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".STATE", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".STATE",
					type: "state",
						common: {
						name: ParsedJSON.ITEMS[x].NAME + ":STATE",
						type: "boolean",
						role: "switch"
					},
					native: {}
					});
						
					if (x > 15 && x < 40)		// Do not subscribe scenes, master dim and all on/off!
						channelArray.push(x);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".STATE", false, true);
					adapter.log.debug("setupGatewayDevices: Added Device ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);
				break;

				case "DIMMER":
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER, {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER,
					type: "channel",
					common: {
						name: ParsedJSON.ITEMS[x].NAME,
					},
					native: {}
					});
					
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID",
					type: "state",
						common: {
						name: ParsedJSON.ITEMS[x].NAME + ":ID",
						type: "string",
						role: "id",
						write: "false",
						read: "true"
					},
					native: {}
					});	
				
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME",
					type: "state",
						common: {
						name: ParsedJSON.ITEMS[x].NAME + ":NAME",
						type: "string",
						role: "value",
						write: "false",
						read: "true"
					},
					native: {}
					});															
						
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL",
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ":LEVEL",
						type: "number",
						role: "level.dimmer",
						min: 0,
						max: 100
					},
					native: {}
					});	

					if (x > 15 && x < 40)		// Do not subscribe scenes, master dim and all on/off!
						channelArray.push(x);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", "0", true);
					adapter.log.debug("setupGatewayDevices: Added Device ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);
				break;

				case "JALOUSIE":
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER, {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER,
					type: "channel",
					common: {
						name: ParsedJSON.ITEMS[x].NAME,
					},
					native: {}
					});
					
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID",
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ":ID",
						type: "string",
						role: "id",
						write: "false",
						read: "true"
					},
					native: {}
					});	
				
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME",
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ":NAME",
						type: "string",
						role: "value",
						write: "false",
						read: "true"
					},
					native: {}
					});															
						
					adapter.setObjectNotExists("channel" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", {
					_id : adapter.namespace + "channel" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL",
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ":LEVEL",
						type: "number",
						role: "level.blind",
						min: 0,
						max: 100
					},
					native: {}
					});	

					if (x > 15 && x < 40)		// Do not subscribe scenes, master dim and all on/off!
						channelArray.push(x);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
					adapter.setState("channel" + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", "0", true);
					adapter.log.debug("setupGatewayDevices: Added Device ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);
				break;
				
				case "NONE":
					// Device is not programmed/learned on eNet Gateway
				break;
				
				default:
					adapter.log.error("setupGatewayDevices: ERROR! Unknown device type " + ParsedJSON.ITEMS[x].NUMBER + ", Channel: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME);
			}
		}
		
		if (SyncRoomsAndScenes)
		{
			adapter.log.debug("setupGatewayDevices: Reading Rooms...");
			for (var x = 0; x < RoomsCount; x++) 
			{
				adapter.setObjectNotExists("rooms.room" + ParsedJSON.LISTS[x].NUMBER, {
				_id : adapter.namespace + "rooms.room" + ParsedJSON.ITEMS[x].NUMBER,
				type: "channel",
				common: {
					name: ParsedJSON.LISTS[x].NAME,
				},
				native: {}
				});
			
				adapter.setObjectNotExists("rooms.room" + ParsedJSON.LISTS[x].NUMBER + ".ID", {
					_id : adapter.namespace + "rooms.room" + ParsedJSON.ITEMS[x].NUMBER + ".ID",
				type: "state",
					common: {
					name: ParsedJSON.LISTS[x].NAME + ":ID",
					type: "string",
					role: "id",
					write: "false",
					read: "true"
				},
				native: {}
				});	
			
				adapter.setObjectNotExists("rooms.room" + ParsedJSON.LISTS[x].NUMBER + ".NAME", {
				_id : adapter.namespace + "rooms.room" + ParsedJSON.ITEMS[x].NUMBER + ".NAME",
				type: "state",
				common: {
					name: ParsedJSON.LISTS[x].NAME + ":NAME",
					type: "string",
					role: "value",
					write: "false",
					read: "true"
				},
				native: {}
				});								
			
				if (ParsedJSON.LISTS[x].ITEMS_ORDER)			// There are devices in this room
				{
					var DevicesInRoom = ParsedJSON.LISTS[x].ITEMS_ORDER;
					adapter.setObjectNotExists("rooms.room" + ParsedJSON.LISTS[x].NUMBER + ".DEVICES", {
					_id : adapter.namespace + "rooms.room" + ParsedJSON.ITEMS[x].NUMBER + ".DEVICES",
					type: "state",
					common: {
						name: ParsedJSON.LISTS[x].NAME + ":DEVICES",
						type: "string",
						role: "value",
						write: "false",
						read: "true"
					},
					native: {}
					});		
					adapter.setState("rooms.room" + ParsedJSON.LISTS[x].NUMBER + ".DEVICES", DevicesInRoom.toString(), true);
				}

				adapter.setState("rooms.room" + ParsedJSON.LISTS[x].NUMBER + ".ID", ParsedJSON.LISTS[x].NUMBER, true);
				adapter.setState("rooms.room" + ParsedJSON.LISTS[x].NUMBER + ".NAME", ParsedJSON.LISTS[x].NAME, true);
				adapter.log.debug("setupGatewayDevices: Added Room ID: " + ParsedJSON.LISTS[x].NUMBER + ", Name: " + ParsedJSON.LISTS[x].NAME);						
			}
		}		

		adapter.log.debug("setupGatewayDevices: Channels for subscription: " + channelArray.toString());
		adapter.setObjectNotExists("gateway.subscribeable_channels", {
		_id : adapter.namespace + "gateway.subscribeable_channels",
		type: "state",
		common: {
		name: "eNet channels to subscribe for",
			type: "string",
			role: "value",
			read: true,
			write: false
		},
		native: {}
		});		

		adapter.setState("gateway.subscribeable_channels", JSON.stringify(channelArray), true);
		
		main();
	}
};

function setGatewayChannel(ip, id, channel, state)
{
	var gw = eNet.gateway({host: ip});
	gw.connect();
	
	adapter.getObject(id, function (err, obj) 
	{
		if (!err && obj)
		{
			switch (obj.common.role)
			{
				case "switch":				// Actor/Switch/Light
					adapter.log.debug("SetGatewayChannel: SWITCH: ID: " + id + ", Object Type: " + obj.common.type + " Object Role: " + obj.common.role);
					gw.setValue(channel, state, false, function(err, res) 
					{
						if (err) 
							adapter.log.error("SetGatewayChannel: Error in setting SWITCH value: ID: " + id + ", Object Type: " + obj.common.type + " Object Role: " + obj.common.role + ", VALUE: " + state + ", Error: " + JSON.stringify(err));
						else 
						adapter.log.debug("setGatewayChannel: Command successfull: \n" + JSON.stringify(res));
					})
				break;
				case "level.dimmer":		// Dimmer
					adapter.log.debug("SetGatewayChannel: DIMMER: ID: " + id + ", Object Type: " + obj.common.type + " Object Role: " + obj.common.role);
					gw.setValueDim(channel, state, false, function(err, res) 
					{
						if (err) 
							adapter.log.error("SetGatewayChannel: Error in setting DIMMER value: ID: " + id + ", Object Type: " + obj.common.type + " Object Role: " + obj.common.role + ", VALUE: " + state);
						else 
						adapter.log.debug("setGatewayChannel: Command successfull: \n" + JSON.stringify(res));
					})
				break;
				case "level.blind":			// Jalousie
					adapter.log.debug("SetGatewayChannel: SHUTTER: ID: " + id + ", Object Type: " + obj.common.type + " Object Role: " + obj.common.role);
					gw.setValueBlind(channel, state, false, function(err, res) 
					{
						if (err) 
							adapter.log.error("SetGatewayChannel: Error in setting SHUTTER value: ID: " + id + ", Object Type: " + obj.common.type + " Object Role: " + obj.common.role + ", VALUE: " + state);
						else 
						adapter.log.debug("setGatewayChannel: Command successfull: \n" + JSON.stringify(res));
					})
				break;
			}
		}
	}); 	
};

if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
} 