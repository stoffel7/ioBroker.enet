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
var SessionID = "";
var CounterID = "";
var IBN = "";
var ncd = 1;
var Zaehler = 1;
var devtyp='';
var devUID='';
var get_login_digest='{"jsonrpc":"2.0","method":"getDigestAuthentificationInfos","params":null,"id":"$$id$$"}'; 
var get_configuration='{"jsonrpc":"2.0", "method":"getCurrentConfiguration", "params":null, "id":"$$id$$"}';
var get_locations='{"jsonrpc":"2.0", "method":"getLocations", "params":{"locationUIDs":[]}, "id":"$$id$$"}';
var get_eventid='{"jsonrpc":"2.0", "method":"getDevicesWithParameterFilter", "params":{"deviceUIDs":["$$devuid$$"], "filter":".+\\\\.(SCV1|SCV2|SNA|PSN)\\\\[(.|1.|2.|3.)\\\\]+"}, "id":"$$id$$"}';
var get_currentvalues='{"jsonrpc":"2.0", "method":"getCurrentValuesFromOutputDeviceFunction", "params":{"deviceFunctionUID":"$$eventuid$$"}, "id":"$$id$$"}';
var set_state='{"jsonrpc":"2.0", "method":"callInputDeviceFunction", "params":{"deviceFunctionUID":"$$UID$$", "values":[{"valueTypeID":"VT_SCALING_RANGE_0_100_DEF_0", "value":$$Wert$$}]}, "id":"$$id$$"}';


function startAdapter(options) 
{
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
				if (id.indexOf('.value') > -1)
				{
					if (state && !state.ack)
					{
						var stateStr = id;
						var StateToChange = stateStr.replace(".value", ".eventUID");
						var tempSetState = adapter.getState(StateToChange, function (err, tempstate) 
						{
							if (tempstate)
							{
								adapter.log.debug("State Change ID: " + id + ", eNet UID: " + tempstate.val + ", Value: " + state.val + ", Value type: " + typeof(state.val));
								eNetServer_SetState(tempstate.val, state.val);
							}
						});
					}
				}
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
					clearInterval(pollTimerStates);
					pollTimerStates = null;				
					eNetServer_Logout();
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
				init_server();
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
			adapter.log.info("Running eNet Adapter Version " + adapter.version + ", Configured eNet Server: " + adapter.config.ip + ", Username: " + adapter.config.username);
			eNetServer_Login();
		}
	}
}

function init_server()
{
	var DoRestart = false;
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (!state)
		{
			adapter.setObjectNotExists("eNet.SessionID", {_id : adapter.namespace + "eNet.SessionID", type: "state", common: {name: "eNet Server Session ID", type: "string", role: "value", read: true, write: true},native: {}});
			adapter.setState('eNet.SessionID', "", {unit: ''});
			DoRestart = true;
		}
	});
	var tempCounterID =	adapter.getState("eNet.CounterID", function (err, state) 
	{
		if (!state)
		{
			adapter.setObjectNotExists("eNet.CounterID", {_id : adapter.namespace + "eNet.CounterID", type: "state", common: {name: "eNet Server Counter ID", type: "string", role: "value", read: true, write: true},native: {}});
			adapter.setState('eNet.CounterID', 0, {unit: ''});
			DoRestart = true;
		}
	});
	var tempICP = adapter.getState("eNet.ICP", function (err, state) 
	{
		if (!state)
		{
			adapter.setObjectNotExists("eNet.ICP", {_id : adapter.namespace + "eNet.ICP", type: "state", common: {name: "eNet Server ICP", type: "string", role: "value", read: true, write: true},native: {}});
			adapter.setState('eNet.ICP', "", {unit: ''});
			DoRestart = true;
		}
	});
	if (DoRestart)
		adapter.log.error("Initialization finished. Please restart adapter!");
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
			pollTimerStates = setInterval(eNetServer_GetCurrentValues, 10000);
		}
	}
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///																																											//
///          BEGIN ENET SERVER ROUTINES 																																	//
///																																											//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
            
function GenerateRandom(len) 
{
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabzdefghijklmnopqrstuvwxyz0123456789';
    var token = '';
    for (var i = 0; i < len; i++) 
	{
        var randNum = Math.round(Math.random() * characters.length);
        token += characters.substr(randNum, 1);
    }
    return token;
}

function Traverse(o) 
{
	for (var i in o) 
	{
        if (o[i] !== null && typeof(o[i])=="object") 
            Traverse(o[i]);
	}
}

function eNetServer_CalculateLoginDigest(challengeParams)
{
	var ha1 = crypto.createHash('sha1').update(adapter.config.username+':Insta-NetBox:'+adapter.config.password).digest('hex');
    var ha1u=ha1.toUpperCase();
    var ha2 = crypto.createHash('sha1').update('POST:/jsonrpc//management' ).digest('hex');
    var ha2u=ha2.toUpperCase();
    var nc=('00000000' + ncd).slice(-8);
    var cnonce=GenerateRandom(40);
    var ha3 = crypto.createHash('sha1').update(ha1u + ':' + challengeParams.result.nonce + ':'+nc+':'+cnonce+':auth:' + ha2u).digest('hex');
    var response=ha3.toUpperCase();
    var authRequestParams = {username : adapter.config.username, realm : challengeParams.result.realm, nonce : challengeParams.result.nonce, uri : challengeParams.result.uri, qop : challengeParams.result.qop, opaque : challengeParams.result.opaque, response : response, nc : nc , cnonce: cnonce};
	var user_login_digest='{"jsonrpc":"2.0", "method":"userLoginDigest", "params":{"userName":"'+adapter.config.username+'", "uri":"/jsonrpc//management", "qop":"auth", "cnonce":"'+authRequestParams.cnonce+'", "nc":"'+authRequestParams.nc+'", "response":"'+response+'", "realm":"Insta-NetBox", "nonce":"'+authRequestParams.nonce+'", "algorithm":"sha", "opaque":"'+authRequestParams.opaque+'"}, "id":"$$id$$"}';
    return user_login_digest;
}

function eNetServer_SendLoginDigest(body) 
{
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/management', method:'POST', headers: {'Content-Type': 'application/json'}};
    options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
    var req = http.request(options, function(res) 
	{
		adapter.log.debug('Status SendeLoginDigest: ' + res.statusCode);
        adapter.log.debug('senddeHeaders SendeLoginDigest: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');
		res.on('data', function (body) 
		{
			adapter.log.debug('Body SendeLoginDigest: ' + body);
        });
		req.on('error', function(e) {
        adapter.log.error('problem with request SendeLoginDigest: ' + e.message);
        });
    });
    req.write(body);
    req.end();
}

function eNetServer_IBN_Client() 
{
    var options = {host: adapter.config.ip, port: 80};
    var icp = GenerateRandom(20);
    adapter.setState('eNet.ICP', icp, {unit: ''});
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			adapter.log.debug("eNet Server GetConfiguration Session ID: " + SessionID);
			options.headers={'Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			options.method='GET';
			options.path='/ibnclient.html?icp='+icp;
			adapter.log.debug('eNetServer IBN Client ICP:'+icp);
			var req = http.request(options, function(res) 
			{
				adapter.log.debug('Status: ' + res.statusCode);
				res.setEncoding('utf8');
				res.on('data', function (body) 
				{
				});
				req.on('error', function(e) 
				{
					adapter.log.error('IBN_Client Problem with request: ' + e.message);
				});
			});
			req.write('');
			req.end();
		}
	});
}			

function eNetServer_Login()
{
	adapter.log.debug("Starting Login");
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/management', method:'POST', headers: {'Content-Type': 'application/json'}};
	options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
	var tempZaehler = adapter.getState("eNet.CounterID", function (err, state) 
	{
		if (state)
		{
			Zaehler = state.val;
			var body = get_login_digest.replace('$$id$$', Zaehler.toString());
			var req = http.request(options, function(res) 
			{
				adapter.log.debug('Status Login: ' + res.statusCode);
				adapter.log.debug('Headers Login: ' + JSON.stringify(res.headers));
				SessionID = res.headers['x-clientcredentials-sessionid'].toString();
				adapter.setState('eNet.SessionID', SessionID, {unit: ''});
				res.setEncoding('utf8');
				res.on('data', function (body) 
				{
					adapter.log.debug('Body Login: ' + body);
					var challengeParams = JSON.parse(body);
					var login_digest= eNetServer_CalculateLoginDigest(challengeParams);
					Zaehler++;
					login_digest = login_digest.replace("$$id$$",Zaehler.toString());
					adapter.log.debug('Login Digest Login: ' + login_digest);
					adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
					adapter.log.debug("sende login Login:"+login_digest);
					eNetServer_SendLoginDigest(login_digest);
					adapter.setState("info.connection", true, true);
					var tempIBN = adapter.getState("eNet.ICP", function (err, state) 
					{
						if (state)
						{
							IBN = state.val;
							if (IBN === '' ) 
							{ 
								adapter.log.debug("eNet Server GetConfiguration Init IBN is empty, creating new...");
								eNetServer_IBN_Client(); 
								eNetServer_GetConfiguration()
							}
							else 
							{
								adapter.log.debug("eNet Server GetConfiguration Init IBN: " + IBN);
								eNetServer_GetConfiguration()
							}
						}
					});		
				});
				req.on('error', function(e) 
				{
					adapter.log.error('problem with request Login: ' + e.message);
					adapter.setState("info.connection", false, true);
				});
			});
			req.write(body);
			req.end();
		}
	});	
}
                                
function eNetServer_GetConfiguration() 
{
	var options = 
	{
		host: adapter.config.ip,
		port: 80,
		path: '/jsonrpc/visualization',
		method:'POST',
		headers: {'Content-Type': 'application/json'}
	};
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			adapter.log.debug("eNet Server GetConfiguration Session ID: " + SessionID);
			options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			var tempZaehler = adapter.getState("eNet.CounterID", function (err, state) 
			{
				if (state)
				{
					Zaehler = state.val;
					adapter.log.debug("eNet Server GetConfiguration Counter ID: " + Zaehler);
					Zaehler++;
					adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
					var body_in=get_configuration.replace('$$id$$',Zaehler.toString());
					var req = http.request(options, function(res) 
					{
						adapter.log.debug('GetConfiguation Status: ' + res.statusCode);
						adapter.log.debug('GetConfiguration senddeHeaders: ' + JSON.stringify(res.headers));
						res.setEncoding('utf8');
						res.on('data', function (body) 
						{
							adapter.log.debug('GetConfiguration Body: ' + body); 
							var obj=JSON.parse(body);
							if (obj.hasOwnProperty('error')) 
							{
								adapter.log.error('GetConfiguration Error: ' + obj.error.message)
							} 
							else 
							{
								var configUID=obj.result.configurationUID;
								adapter.setState('eNet.ConfigurationID', configUID, {unit: ''});
								var configName=obj.result.configurationName;
								adapter.setState('eNet.ConfigurationName', configName, {unit: ''});
								eNetServer_GetLocations();
							}
						});
						req.on('error', function(e) 
						{
							adapter.log.error('problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					req.end();
				}
			});
		}
	});						
}

function eNetServer_GetLocations() 
{
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
	var body_out=''
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID =	adapter.getState("eNet.CounterID", function (err, state) 
			{
				if (state)
				Zaehler = state.val;
				options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
				Zaehler++;
				adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
				var body_in = get_locations.replace('$$id$$',Zaehler.toString());
				var req = http.request(options, function(res) 
				{
					adapter.log.debug('GetLocations Status: ' + res.statusCode);
					res.setEncoding('utf8');
					res.on('data', function (data) 
					{
						body_out += data;
					});
					res.on('end', function () 
					{
						var obj=JSON.parse(body_out)
						if (obj.hasOwnProperty('error')) 
						{
							adapter.log.error('GetLocations Error: '+obj.error.message)
						} 
						else 
						{
							var p=obj['result']['locations'].length
							var e=obj['result']['locations'][0]['childLocations'].length
							var r=obj['result']['locations'][0]['childLocations'][0]['childLocations'].length
							var d=obj['result']['locations'][0]['childLocations'][0]['childLocations'][0]['deviceUIDs'].length
							adapter.log.debug('GetLocations Locations: ' + p+'#'+e+'#'+r+'#'+d)
							adapter.log.debug('GetLocations JSON: ' + body_out);
							for (var i=0; i<p;i++) 
							{
								var projekt=obj['result']['locations'][i].name
								adapter.log.debug('GetLocations, Projekt: ' + projekt);
								for (var j=0;j<e;j++) 
								{
									var etage=obj['result']['locations'][i]['childLocations'][j].name
									adapter.log.debug('GetLocations, Etage: ' + etage);
									for (var k=0;k<r;k++) 
									{
										var raum=obj['result']['locations'][0]['childLocations'][0]['childLocations'][k].name
										adapter.log.debug('GetLocations, Raum: ' + raum);
										for (var l=0;l<d;l++) 
										{
											adapter.log.debug('Location Object: ' + l)
											var devuid=obj['result']['locations'][i]['childLocations'][j]['childLocations'][k]['deviceUIDs'][l].deviceUID
											var devtyp=obj['result']['locations'][i]['childLocations'][j]['childLocations'][k]['deviceUIDs'][l].deviceTypeID
											var iopfad=projekt.replace(' ','_')+'.'+etage+'.'+raum+'.'+l; //l=position
											adapter.log.debug('Location Path: ' + iopfad)
											adapter.log.debug('GetLocations, Projekt: ' + projekt + ', Etage: ' + etage + ', Raum: ' + raum + ', DeviceUID: ' + devuid + ', deviceTypeID: ' + devtyp + ', Pfad: ' + iopfad);
											eNetServer_GetEventId(iopfad,l,devtyp,devuid)
										}
									}
								}
							}
						}
					});
					req.on('error', function(e) 
					{
						adapter.log.error('GetLocations: Problem with request: ' + e.message);
					});
				});
				req.write(body_in);
				req.end();
			});
		}
	});
}

function eNetServer_GetEventId(pfad,pos,typ,uid) 
{
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var body_out=''
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID =	adapter.getState("eNet.CounterID", function (err, state) 
			{
				if (state)
				{
					Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
					var body_in=get_eventid.replace('$$id$$',Zaehler.toString());
					body_in=body_in.replace('$$devuid$$',uid)
					var req = http.request(options, function(res) 
					{
						adapter.log.debug('GetEventId Status: ' + res.statusCode);
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							if (typ !== 'DVT_HS4')	// Handsender ausschließen!
							{
								var obj=JSON.parse(body_out)
								var installArea=obj['result']['devices'][0]['installationArea'];
								var state=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][1]['deviceChannels'][0]['outputDeviceFunctions'][2]['currentValues'][0]['value'];
								var eventUID=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][1]['deviceChannels'][0]['outputDeviceFunctions'][2]['uid']
								adapter.log.debug('GetEventID: Type: ' + typ + ', Install Area: ' + installArea + ', Current Value: ' + state + ', eventUID: ' + eventUID);
								if (typ !== 'DVT_SJA1')
								{
									var inputUID=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][1]['deviceChannels'][0]['inputDeviceFunctions'][4]['uid']
									adapter.setObjectNotExists('eNet.'+pfad+'.inputUID', {_id : adapter.namespace + 'eNet.'+pfad+'.inputUID', type: "state", common: {name: 'eNet.'+pfad+'.inputUID', type: "string", role: "value", read: true, write: true},native: {}});
									adapter.setState('eNet.'+pfad+'.inputUID',  inputUID, {unit: ''});
								}
								adapter.setObjectNotExists('eNet.'+pfad+'.value', {_id : adapter.namespace + 'eNet.'+pfad+'.value', type: "state", common: {name: 'eNet.'+pfad+'.value', type: "string", role: "value", read: true, write: true},native: {}});
								adapter.setState('eNet.'+pfad+'.value',  state, {unit: ''});

								adapter.setObjectNotExists('eNet.'+pfad+'.eventUID', {_id : adapter.namespace + 'eNet.'+pfad+'.eventUID', type: "state", common: {name: 'eNet.'+pfad+'.eventUID', type: "string", role: "value", read: true, write: true},native: {}});
								adapter.setState('eNet.'+pfad+'.eventUID',  eventUID, {unit: ''});
							}
						});
						req.on('error', function(e) 
						{
							adapter.log.error('problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					req.end();
				}
			});
		}
	});
}

function eNetServer_GetCurrentValues()
{
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var body_out=''
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			var tempZaehler = adapter.getState("eNet.CounterID", function (err, state) 
			{
				if (state)
				{
					Zaehler = state.val;
					adapter.getStates(adapter.namespace + ".eNet.*.*.*.*eventUID", function (err, states) 
					{
						for (var id in states) 
						{
							var tempUID = adapter.getState(id, function (err, state)
							{
								if (!err && state)
								{
									var uid = state.val;
									var tempPath = adapter.getObject(id, function (err, obj)
									{
										if (!err && obj)
										{
											var path = obj.common.name;
											var parent = path.replace('.eventUID','')
											adapter.log.debug('GetCurrentValues ID: ' + id + ',  UID: ' + uid + ' Path: ' + path + ', Parent: ' + parent);
											options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
											Zaehler++;
											adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
											var body_in=get_currentvalues.replace('$$id$$',Zaehler.toString());
											body_in=body_in.replace('$$eventuid$$',uid.toString());
											var req = http.request(options, function(res) 
											{
												adapter.log.debug('GetCurrentValues Status: ' + res.statusCode + ' Headers: ' + JSON.stringify(res.headers));
												res.setEncoding('utf8');
												res.on('data', function (data) 
												{
													body_out += data;
												});
					
												res.on('end', function () 
												{
													try
													{
														adapter.log.debug('GetCurrentValues Body: ' + body_out);
														var obj=JSON.parse(body_out)
														if (obj.hasOwnProperty('error')) 
															adapter.log.error('GetCurrentValues Error: '+obj.error.message)
														else 
														{
															var status=obj['result']['currentValues'][0]['value'];
															adapter.log.debug('GetCurrentValues GetCurrentValues Path: ' + parent + ', Value: ' + status + ', Type: ' + typeof(status) + ', Object: ' + parent + '.value');
															switch(typeof(status))
															{
																case "number":
																	adapter.setState(parent + '.value', parseInt(status),{unit: ''});
																break;

																case "boolean":
																	adapter.setState(parent + '.value', status,{unit: ''});
																break;
															
																case "string":
																	adapter.setState(parent + '.value', status,{unit: ''});
																break;
																														
																default:
																	adapter.log.error('GetCurrentValues: No known datatype for value');
															}
														}
													}
													catch (e)
													{
														adapter.log.error('GetCurrentValues error: ' + e);
													}
												});
		
												req.on('error', function(e) 
												{
													adapter.log.error('GetCurrentValues Problem with request: ' + e.message);
												});	
											});
											req.write(body_in);
											req.end();
										}
									});
								}
							});
						}
					});
				}
			});
		}
	});
}

function eNetServer_SetState(uid,wert) 
{
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var body_out=''
	var tempSessionID =	adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			adapter.log.debug("eNet Server SetState Session ID: " + SessionID);
			var tempZaehler = adapter.getState("eNet.CounterID", function (err, state) 
			{
				if (state)
				{
					Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
					var body_in=set_state.replace('$$id$$',Zaehler.toString());
					body_in=body_in.replace('$$UID$$',uid);
					body_in=body_in.replace('$$Wert$$',wert);
					var req = http.request(options, function(res) 
					{
						adapter.log.debug('eNetServer SetState Request Status: ' + res.statusCode);
						res.setEncoding('utf8');

						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							adapter.log.debug('eNetServer SetState Body: ' + body_out);
							var obj=JSON.parse(body_out)
        				});
        
						req.on('error', function(e) 
						{
							adapter.log.error('eNetServer SetState Problem with request: ' + e.message);
						});
					});
				
					req.write(body_in);
					req.end();
				}
			});
		}
	});
}

function eNetServer_Logout() 
{
	adapter.log.debug("eNet Server Logout Start");
	
	var options = {host: adapter.config.ip, port: 80, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
	var reqstr=[];
	reqstr.push('{"jsonrpc":"2.0", "method":"setClientRole", "params":{"clientRole":"CR_IBN"}, "id":"$$id$$"}')
	reqstr.push('{"jsonrpc":"2.0", "method":"registerEventConfigurationParameterChanged", "params":{"configurationUID":"90f37543-7ba6-4eb2-8481-5a58e2f255e4", "parameterID":"P_CFG_PRJ_SAVING"}, "id":"$$id$$"}')
	reqstr.push('{"jsonrpc":"2.0", "method":"setValueToConfigurationParameter", "params":{"configurationUID":"90f37543-7ba6-4eb2-8481-5a58e2f255e4", "parameterID":"P_CFG_PRJ_SAVING", "value":true}, "id":"$$id$$"}')
	reqstr.push('{"jsonrpc":"2.0", "method":"requestEvents", "params":null, "id":"$$id$$"}')
	reqstr.push('{"jsonrpc":"2.0", "method":"unregisterEventConfigurationParameterChanged", "params":{"configurationUID":"90f37543-7ba6-4eb2-8481-5a58e2f255e4", "parameterID":"P_CFG_PRJ_SAVING"}, "id":"$$id$$"}')
	var durchlauf = 0;
	Zaehler = 0;
    var body_out = ''
	var tempSessionID = adapter.getState("eNet.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			adapter.log.debug("eNet Server Logout Session ID: " + SessionID);
			var tempCounterID = adapter.getState("eNet.CounterID", function (err, state) 
			{
				if (state)
				{
					CounterID = state.val;
					adapter.log.debug("eNet Server Logout Counter ID: " + CounterID);
					options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler = CounterID
					adapter.log.debug("eNet Server Logout Counter ID: " + Zaehler);
					Zaehler++;
					adapter.setState('eNet.CounterID', Zaehler, {unit: ''});
					var body_in = reqstr[durchlauf].replace('$$id$$',Zaehler.toString());
					var req = http.request(options, function(res) 
					{
						adapter.log.debug("eNet Server Logout Status: " + res.StatusCode);
						adapter.log.debug("eNet Server Logout Send Headers: " + JSON.stringify(res.headers));
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
							if (typeof(body) !== "undefined")			
							{
								adapter.log.debug("eNet Server Logout Data Body: " + body);
								traverse(JSON.parse(body));
							}
						});
						res.on('end', function () 
						{
							if (typeof(body) !== "undefined")			
							{
								adapter.log.debug("eNet Server Logout End Body: " + body);
								durchlauf++;
								if (durchlauf<reqstr.length)
								{
									adapter.log.debug("eNet Server Logout Step: " + durchlauf);
									eNetServer_Logout();
								}
							}
						});
						req.on('error', function(e) 
						{
							adapter.log.error("eNet Server Logout Error: " + e.messsage);
							adapter.setState("info.connection", false, true);
						});
						adapter.setState("info.connection", false, true);
						adapter.setState('eNet.SessionID', "", {unit: ''});
						adapter.setState('eNet.CounterID', 0, {unit: ''});
						adapter.setState('eNet.ICP', "", {unit: ''});
					});
					adapter.log.debug("eNet Server Logout Request Body IN: " + body_in);
					req.write(body_in);
					req.end();
				}
			});
		}
	});
}


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

	adapter.getState("eNet.subscribeable_channels", function (err, state) 
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
		adapter.setObjectNotExists("eNet.subscribeable_channels", {
		_id : adapter.namespace + "eNet.subscribeable_channels",
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

		adapter.setState("eNet.subscribeable_channels", JSON.stringify(channelArray), true);
		
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