"use strict";

var utils = require(__dirname + "/lib/utils");
var eNet = require(__dirname + "/lib/enet");
var Gateway = require(__dirname + "/lib/gateway");
var pollTimerStates = null;
var SyncRooms;
var SyncScenes;
var adapter = new utils.Adapter("enet");

adapter.on("stateChange", function (id, state) 
{
	var eNetChannelArray = id.split(".");
	var eNetChannel = eNetChannelArray[3];
	if (state && !state.ack)
		setGatewayChannel(adapter.config.ip, id, eNetChannel, state.val);
});

adapter.on("unload", function (callback) {
    try 
	{
		adapter.setState("gateway.connected", false, true);
		clearInterval(pollTimerStates);
		pollTimerStates = null;				
        callback();
    } 
	catch (e) 
	{
        callback();
    }
});

adapter.on("ready", function () 
{
    main();
});

function deleteStates(states, callback) 
{
	if (!states || !states.length) 
	{
		if (callback) callback();
		return;
	}
	var id = states.pop();
	adapter.delObject(id, function (err) 
	{
		adapter.delState(id, function (err) 
		{
		});         
	});
};

function main() {
	if (adapter.config.ip)
	{
		SyncRooms = adapter.config.sync_rooms;
		SyncScenes = adapter.config.sync_scenes;
		
		if (SyncRooms)
		{
			adapter.getStates(adapter.namespace + ".rooms.*", function (err, states) 
			{
				var toDelete = [];
				for (var id in states) 
				{
					toDelete.push(id);
				}
				deleteStates(toDelete, function() 
				{
				});
			});
		}
		
		if (SyncScenes)
		{
			adapter.getStates(adapter.namespace + ".scenes.*", function (err, states) 
			{
				var toDelete = [];
				for (var id in states) 
				{
					toDelete.push(id);
				}
				deleteStates(toDelete, function() 
				{
				});
			});		
		}
		
		adapter.subscribeStates("*");
		getGatewayDevices(adapter.config.ip);
		getGatewayInformation(adapter.config.ip);
		if (parseInt(adapter.config.interval, 10))
			pollTimerStates = setInterval(getGatewayStates, parseInt(adapter.config.interval, 10));
	}
}
	
	
function getGatewayStates()
{
	if (SyncRooms || SyncScenes)
	{
		adapter.extendForeignObject('system.adapter.' + adapter.namespace, {native: {sync_rooms: false, sync_scenes: false}});
		return;
	}

	// Channel subscription -> write state to ioBroker if channel changes
	adapter.log.debug("getGatewayStates: Starting to retrieve the current states from eNet gateway");

	adapter.getState("gateway.subscribeable_channels", function (err, state) 
	{
        if (state)
		{
			var eNetChannelList;
			eNetChannelList = JSON.parse(state.val);
			adapter.log.debug("getGatewayStates: Array of subscribable Channels: " + eNetChannelList.toString());
			
			var Gateway = eNet.gateway({host: adapter.config.ip});
			Gateway.connect();
			Gateway.signIn(eNetChannelList, function(err, res)
			{
				if (err) 
				{
					adapter.log.error("getGatewayStates: Error on signing in channels for subscription: " + err);
					adapter.setState("gateway.connected", false, true)
				}
				if (res) 
				{
					adapter.log.debug.log("getGatewayStates: Sucess in singing in to channels: " + JSON.stringify(res));
					adapter.setState("gateway.connected", true, true);
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
							adapter.getState("channels." + eNetChannel.toString() + ".STATE", function (err, state) 
							{
								if (state)
								{
									var eNetValue = ParsedJSON.STATE;
									adapter.log.debug("getGatewayStates: (channels." + eNetChannel.toString() + ".STATE) Channel: " + eNetChannel.toString() + ", Value: " + eNetValue.toString() + ", State: " + ParsedJSON.STATE + ", Setpoint: " + ParsedJSON.SETPOINT + ", Data for channel: " + JSON.stringify(msg));
									var ActualValue = state.val;
									if (eNetValue == "OFF")
										eNetValue = false;
									if (eNetValue == "ON")
										eNetValue = true;
									if (eNetValue == -1)
										eNetValue = false;
									if (ActualValue != eNetValue)
									{
										adapter.log.debug("getGatewayStates: Setting state for channel: " + eNetChannel.toString() + " to ioBroker objects DB Old Value: " + ActualValue + " new Value: " + eNetValue);
										adapter.setState("channels." + eNetChannel.toString() + ".STATE", eNetValue, true);
									}
								}
							});						
							
							adapter.getState("channels." + eNetChannel.toString() + ".LEVEL", function (err, state) 
							{
								if (state)
								{
									var eNetValue = ParsedJSON.VALUE;
									adapter.log.debug("getGatewayStates: (channels." + eNetChannel.toString() + ".LEVEL) Channel: " + eNetChannel.toString() + ", Value: " + eNetValue.toString() + ", State: " + ParsedJSON.STATE + ", Setpoint: " + ParsedJSON.SETPOINT + ", Data for channel: " + JSON.stringify(msg));
									var ActualValue = state.val;
									if (eNetValue == -1)
										eNetValue = 0;
									if (ActualValue != eNetValue)
									{
										adapter.log.debug("getGatewayStates: Setting state for channel: " + eNetChannel.toString() + " to ioBroker objects DB Old Value: " + ActualValue + " new Value: " + eNetValue);
										adapter.setState("channels." + eNetChannel.toString() + ".LEVEL", eNetValue.toString(), true);
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
			adapter.setState("gateway.connected", true, true);
			setupDevices(gw, JSON.stringify(res));
		}
		gw.disconnect();
	})
};

function setupDevices(gw, res)
{
	// 0 to 15: Scenes
	// 16 to 41: Channel/Device 1 to 24
	// 42 to 43: All on/off and Master Dim
	var ParsedJSON = JSON.parse(res);
	if (ParsedJSON)
	{
		adapter.log.debug("setupDevices: Got JSON device information from eNet gateway. Count of Devices: " + ParsedJSON.ITEMS.length + ", " + "Count of rooms: " + ParsedJSON.LISTS.length);
		var DevicesCount = ParsedJSON.ITEMS.length;
		var RoomsCount = ParsedJSON.LISTS.length;

		// Setting up devices/channels
		adapter.log.debug("setupDevices: Reading Scenes/Channels/Devices...");
		var channelArray = [];
		for (var x = 0; x < DevicesCount; x++) 
		{
			var JSONDeviceType = ParsedJSON.ITEMS[x].TYPE;
			var DeviceType = JSONDeviceType.toUpperCase();
			switch(DeviceType)
			{
				case "SCENE":
					if (SyncScenes === true)
					{
						adapter.setObjectNotExists("scenes." + ParsedJSON.ITEMS[x].NUMBER, {
						type: "device",
						common: {
							name: ParsedJSON.ITEMS[x].NUMBER,
							type: "string",
							role: "device"
						},
						native: {}
						});
					
						adapter.setObjectNotExists("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
						type: "state",
							common: {
							name: ParsedJSON.ITEMS[x].NAME + ".ID",
							type: "string",
							role: "id"
						},
						native: {}
						});	
			
						adapter.setObjectNotExists("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
						type: "state",
						common: {
							name: ParsedJSON.ITEMS[x].NAME + ".NAME",
							type: "string",
							role: "id"
						},
						native: {}
						});								
			
						if (ParsedJSON.ITEMS[x].DIMMABLE)
						{
							adapter.setObjectNotExists("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", {
							type: "state",
							common: {
								name: ParsedJSON.ITEMS[x].NAME + ".LEVEL",
								type: "number",
								role: "scene.state",
								min: 0,
								max: 100								
							},
							native: {}
							});							
						}
						else
						{
							adapter.setObjectNotExists("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".STATE", {
							type: "state",
							common: {
								name: ParsedJSON.ITEMS[x].NAME + ".STATE",
								type: "boolean",
								role: "scene.state"
							},
							native: {}
							});
						}
						
						adapter.setState("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
						adapter.setState("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
						adapter.setState("scenes." + ParsedJSON.ITEMS[x].NUMBER + ".STATE", false, true);
						adapter.log.debug("setupDevices: Added Scene ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);						
					}
				break;
				
				case "BINAER":
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER, {
					type: "device",
					common: {
						name: ParsedJSON.ITEMS[x].NUMBER,
						type: "string",
						role: "device"
					},
					native: {}
					});
					
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
					type: "state",
						common: {
						name: ParsedJSON.ITEMS[x].NAME + ".ID",
						type: "string",
						role: "id"
					},
					native: {}
					});	
			
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ".NAME",
						type: "string",
						role: "id"
					},
					native: {}
					});								
			
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER + ".STATE", {
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ".STATE",
						type: "boolean",
						role: "switch"
					},
					native: {}
					});
						
					if (x > 15 && x < 40)		// Do not subscribe scenes, master dim and all on/off!
						channelArray.push(x);
					adapter.setState("channels." + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
					adapter.setState("channels." + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
					adapter.setState("channels." + ParsedJSON.ITEMS[x].NUMBER + ".STATE", false, true);
					adapter.log.debug("setupDevices: Added Device ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);
				break;

				case "DIMMER":
				case "JALOUSIE":
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER, {
					type: "device",
					common: {
						name: ParsedJSON.ITEMS[x].NUMBER,
						type: "string",
						role: "device"
					},
					native: {}
					});
					
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER + ".ID", {
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ".ID",
						type: "string",
						role: "id"
					},
					native: {}
					});	
				
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ".NAME",
						type: "string",
						role: "id"
					},
					native: {}
					});															
						
					adapter.setObjectNotExists("channels." + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", {
					type: "state",
					common: {
						name: ParsedJSON.ITEMS[x].NAME + ".LEVEL",
						type: "number",
						role: "level.dimmer",
						min: 0,
						max: 100
					},
					native: {}
					});	

					if (x > 15 && x < 40)		// Do not subscribe scenes, master dim and all on/off!
						channelArray.push(x);
					adapter.setState("channels." + ParsedJSON.ITEMS[x].NUMBER + ".ID", ParsedJSON.ITEMS[x].NUMBER, true);
					adapter.setState("channels." + ParsedJSON.ITEMS[x].NUMBER + ".NAME", ParsedJSON.ITEMS[x].NAME, true);
					adapter.setState("channels." + ParsedJSON.ITEMS[x].NUMBER + ".LEVEL", "0", true);
					adapter.log.debug("setupDevices: Added Device ID: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME + ", Type: " + ParsedJSON.ITEMS[x].TYPE);
				break;
				
				case "NONE":
					// Device is not programmed/learned on eNet Gateway
				break;
				
				default:
					adapter.log.error("setupDevices: ERROR! Unknown device type " + ParsedJSON.ITEMS[x].NUMBER + ", Channel: " + ParsedJSON.ITEMS[x].NUMBER + ", Name: " + ParsedJSON.ITEMS[x].NAME);
			}
		}
		
		if (SyncRooms)
		{
			adapter.log.debug("setupDevices: Reading Rooms...");
			for (var x = 0; x < RoomsCount; x++) 
			{
				adapter.setObjectNotExists("rooms." + ParsedJSON.LISTS[x].NUMBER, {
				type: "state",
				common: {
					name: ParsedJSON.LISTS[x].NUMBER,
					type: "string",
					role: "state"
				},
				native: {}
				});
			
				adapter.setObjectNotExists("rooms." + ParsedJSON.LISTS[x].NUMBER + ".ID", {
				type: "state",
					common: {
					name: ParsedJSON.LISTS[x].NAME + ".ID",
					type: "string",
					role: "id"
				},
				native: {}
				});	
			
				adapter.setObjectNotExists("rooms." + ParsedJSON.LISTS[x].NUMBER + ".NAME", {
				type: "state",
				common: {
					name: ParsedJSON.LISTS[x].NAME + ".NAME",
					type: "string",
					role: "id"
				},
				native: {}
				});								
			
				if (ParsedJSON.LISTS[x].ITEMS_ORDER)			// There are devices in this room
				{
					var DevicesInRoom = ParsedJSON.LISTS[x].ITEMS_ORDER;
					adapter.setObjectNotExists("rooms." + ParsedJSON.LISTS[x].NUMBER + ".DEVICES", {
					type: "state",
					common: {
						name: ParsedJSON.LISTS[x].NAME + ".DEVICES",
						type: "string",
						role: "state"
					},
					native: {}
					});		
					adapter.setState("rooms." + ParsedJSON.LISTS[x].NUMBER + ".DEVICES", DevicesInRoom.toString(), true);
				}

				adapter.setState("rooms." + ParsedJSON.LISTS[x].NUMBER + ".ID", ParsedJSON.LISTS[x].NUMBER, true);
				adapter.setState("rooms." + ParsedJSON.LISTS[x].NUMBER + ".NAME", ParsedJSON.LISTS[x].NAME, true);
				adapter.log.debug("setupDevices: Added Room ID: " + ParsedJSON.LISTS[x].NUMBER + ", Name: " + ParsedJSON.LISTS[x].NAME);						
			}
		}		

		adapter.log.debug("setupDevices: Channels for subscription: " + channelArray.toString());
		adapter.setObjectNotExists("gateway.subscribeable_channels", {
		type: "state",
		common: {
		name: "eNet channels to subscribe for",
			type: "string",
			role: "state",
			read: true,
			write: false
		},
		native: {}
		});		

		adapter.setState("gateway.subscribeable_channels", JSON.stringify(channelArray), true);
		
		getGatewayStates();
	}
};

function getGatewayInformation(ip)
{
	var gw = eNet.gateway({host: adapter.config.ip});
	gw.connect();

	// Getting gateway version information
	adapter.log.debug("getGatewayInformation: Connecting to eNet Gateway " + gw.name + " for retrieving version information...");
	gw.getVersion(function(err, res) 
	{
		if (err) 
			adapter.log.error("getGatewayInformation: Error getting eNet Gateway version: " + err);
		else 
		{
			adapter.setState("gateway.connected", true, true);
			var ParsedJSON = JSON.parse(JSON.stringify(res));
			if (ParsedJSON)
			{
				adapter.setState("gateway.firmware_version", ParsedJSON.FIRMWARE, true);
				adapter.setState("gateway.hardware_version", ParsedJSON.HARDWARE, true);
				adapter.setState("gateway.protocol_version", ParsedJSON.PROTOCOL, true);
				adapter.setState("gateway.enet_version", ParsedJSON.ENET, true);
				adapter.log.info("ioBroker Jung/Gira eNet Adapter. Gateway IP: " + gw.name + ", Gateway Firmware: " + ParsedJSON.FIRMWARE + ", Gateway Hardware: " + ParsedJSON.HARDWARE + ", Protocol: " + ParsedJSON.PROTOCOL + ", eNet: " + ParsedJSON.ENET);
			}
		}
		gw.disconnect();
	})
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
				case "???":					// Shutter
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