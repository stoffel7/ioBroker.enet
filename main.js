/* 120824
/* jshint -W097 */
/* jshint strict:false */
/* global require */
/* global RRule */
/* global __dirname */
/* jslint node: true */

"use strict";
var utils = require('@iobroker/adapter-core');
var adapter;
var eNet = require(__dirname + "/lib/enet");
var Gateway = require(__dirname + "/lib/gateway");
var pollTimerStates = null;
var SyncRoomsAndScenes = false;
var ConnectionType_SSL = false;
var Connection_Port = 80;
var eNetType = "Server";
var crypto = require('crypto');
var SessionID = "";
var CounterID = "";
//var IBN = "";
var ncd = 1;
var Zaehler = 1;
var devtyp='';
var devUID='';
// weitere VAR's
var valuePathArray =[];
var devicePathArray=[];
var sceneActionPathArray=[];
var batteryPathArray=[];


var get_login_digest='{"jsonrpc":"2.0","method":"getDigestAuthentificationInfos","params":null,"id":"$$id$$"}'; 
var get_configuration='{"jsonrpc":"2.0", "method":"getCurrentConfiguration", "params":null, "id":"$$id$$"}';
var get_locations='{"jsonrpc":"2.0", "method":"getLocations", "params":{"locationUIDs":[]}, "id":"$$id$$"}';
var get_eventid='{"jsonrpc":"2.0", "method":"getDevicesWithParameterFilter", "params":{"deviceUIDs":["$$devuid$$"], "filter":".+\\\\.(SCV1|SCV2|SNA|PSN)\\\\[(.|1.|2.|3.)\\\\]+"}, "id":"$$id$$"}';
var get_devices='{"jsonrpc":"2.0", "method":"getDevices", "params":{"deviceUIDs":["$$devuid$$"]}, "id":"$$id$$"}';
var get_currentvalues='{"jsonrpc":"2.0", "method":"getCurrentValuesFromOutputDeviceFunction", "params":{"deviceFunctionUID":"$$eventuid$$"}, "id":"$$id$$"}';
var set_state='{"jsonrpc":"2.0", "method":"callInputDeviceFunction", "params":{"deviceFunctionUID":"$$UID$$", "values":[{"valueTypeID":"$$valueTypeID$$", "value":$$Wert$$}]}, "id":"$$id$$"}';
var set_client_role='{"jsonrpc":"2.0", "method":"setClientRole", "params":{"clientRole":"CR_VISU"}, "id":"$$id$$"}';
var register_value_change='{"jsonrpc":"2.0", "method": "registerEventValueChanged","params":{"valueUID":"$$uid$$"},"id":"$$id$$"}'
var request_events='{"jsonrpc":"2.0", "method":"requestEvents", "params":null, "id":"$$id$$"}'




var HTTPRequest = (function() {
  var adapters = {
      false: require('http'),
      true: require('https'),
    };

  return function(connection_type) {
    return adapters[adapter.config.connection_type_ssl]
  }
}());




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

				if (id.indexOf('.action') > -1)
				{
					if (state && !state.ack)
					{
						var parent = id.substring(0,id.lastIndexOf('.'));
						adapter.getForeignObject(parent, function (err, obj) 
						{
							if (obj && obj.native && obj.native.sceneActionUID) 
							{
								adapter.log.debug("Action: " + id + ", eNet Action UID: " + obj.native.sceneActionUID);
								eNetServer_executeAction(obj.native.sceneActionUID);
								adapter.setState(id,false,true)//true=ACK
							}
						});
					}
				}


				if (id.indexOf('.value') > -1)
				{
					if (state && !state.ack)
					{
						var parent = id.substring(0,id.lastIndexOf('.'));
						adapter.getForeignObject(parent, function (err, obj) 
						{
							if (obj && obj.native && obj.native.Input_UID && obj.native.ValueType_ID) 
							{
								adapter.log.debug("State Change ID: " + id + ", eNet Input UID: " + obj.native.Input_UID + " Value Type ID:" +obj.native.ValueType_ID + ", Value: " + state.val + ", Value type: " + typeof(state.val));
								eNetServer_SetState(obj.native.Input_UID, obj.native.ValueType_ID, state.val);
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
			ConnectionType_SSL = adapter.config.connection_type_ssl;
			Connection_Port = adapter.config.connection_port;
			eNetType = adapter.config.devicetype;
			if (eNetType == "Gateway")
			{
				adapter.log.info("Running eNet Adapter Version " + adapter.version + ", Configured eNet Gateway: " + adapter.config.ip);
			}
			else if (eNetType == "Server")
			{
				if (ConnectionType_SSL)
				{
					adapter.log.info("Running eNet Adapter Version " + adapter.version + ", Configured eNet Server: " + adapter.config.ip + " (SSL/HTTPS), Username: " + adapter.config.username + " on port " + Connection_Port);
				}
				else 
				{
					adapter.log.info("Running eNet Adapter Version " + adapter.version + ", Configured eNet Server: " + adapter.config.ip + ", Username: " + adapter.config.username + " on port " + Connection_Port);
				}
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
			init_server(); // NUR EINMAL laufen!!!
			eNetServer_Login();
		}
	}
}


function init_server()
{
	adapter.log.debug('INIT SERVER Routine....')
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (!state)
		{
			adapter.setObjectNotExists("info.SessionID", {_id : adapter.namespace + "info.SessionID", type: "state", common: {name: "eNet Server Session ID", type: "string", role: "value", read: true, write: true},native: {}});
			adapter.setState('info.SessionID', "", true);
		}
	});
	var tempCounterID =	adapter.getState("info.CounterID", function (err, state) 
	{
		if (!state)
		{
			adapter.setObjectNotExists("info.CounterID", {_id : adapter.namespace + "info.CounterID", type: "state", common: {name: "eNet Server Counter ID", type: "string", role: "value", read: true, write: true}, native: {}});
			adapter.setState('info.CounterID', "0", true);
		}
	});
/*	var tempRE = adapter.getState("info.requestEvents", function (err, state) 
	{
		if (!state)
		{
			adapter.setObjectNotExists("info.requestEvents", {_id : adapter.namespace + "info.requestEvents", type: "state", common: {name: "eNet requestEvents", type: "string", role: "value", read: true, write: true},native: {}});
			adapter.setState('info.requestEvents', true, {unit: ''});
		}
	});
*/
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
			// nicht mehr notwendig, wegen RequestEvents
			//pollTimerStates = setInterval(eNetServer_GetCurrentValues, parseInt(adapter.config.interval, 10));
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

function eNetServer_SetClientRole() 
{
	var options = 
	{
		host: adapter.config.ip,
		port: Connection_Port,
		rejectUnauthorized: false,
		path: '/jsonrpc/management',
		method:'POST',
		headers: {'Content-Type': 'application/json'}
	};
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			var tempZaehler = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in=set_client_role.replace('$$id$$',Zaehler.toString());
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
						res.on('data', function (body) 
						{
							try
							{
								adapter.log.debug('SetClientRole Body: ' + body); 
								var obj=JSON.parse(body);
								if (obj.hasOwnProperty('error')) 
								{	
									adapter.log.error('SetClientRole Error: ' + obj.error.message)
								} 	
							}
							catch(e)
							{
								adapter.log.error('Return from eNet Server: "' + e + '". Please try to restart the eNet server, change the connection type (HTTP/HTTPS) and check username/password!');
								adapter.stop();
							}
						});
						req.on('error', function(e) 
						{
							adapter.log.error('Error with request: ' + e.message);
						});
					});
					req.write(body_in);
					req.end();
				}
			});
		}
	});						
}

function eNetServer_SendLoginDigest(body) 
{
	var options = {host: adapter.config.ip, 
			port: Connection_Port, 
			rejectUnauthorized: false,
			path: '/jsonrpc/management', 
			method:'POST', 
			headers: {'Content-Type': 'application/json'}
			};
    options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
    var req = HTTPRequest().request(options, function(res) 
	{
        res.setEncoding('utf8');
	res.on('data', function (body) 
		{
		adapter.log.debug('SendLoginDigest, Body: ' + body);
        });
	res.on('end', function () {
        	console.log('Body: ' + body);
        	eNetServer_SetClientRole();
        });
	req.on('error', function(e) {
        adapter.log.error('Error with request SendLoginDigest: ' + e.message);
        });
    });
    req.write(body);
    req.end();
}


function eNetServer_delTree(projekt)
{
	adapter.getStates(adapter.namespace + "."+projekt+".*", function (err, states) 
	{
		var toDelete = [];
    		for (var id in states) 
    		{
        		//toDelete.push(id);
        		//var id = states.pop();
			//adapter.log.debug('Lösche Objekt: '+id)
			//adapter.log.debug('Lösche State: '+id)
        		adapter.delObject(id, function (err)
        		{
				adapter.log.debug('Lösche Objekt: '+id)
            			adapter.delState(id, function (err)
            			{
				adapter.log.debug('Lösche State: '+id)
            			});        
        		});                    

    		}
	});
}

function eNetServer_Login()
{
	adapter.log.info("Starting Login into eNet Server");
	var options = {
			host: adapter.config.ip,
			port: Connection_Port, 
			rejectUnauthorized: false,
			path: '/jsonrpc/management', 
			method:'POST', 
			headers: {'Content-Type': 'application/json'}
	};
	options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
	var tempZaehler = adapter.getState("info.CounterID", function (err, state)
	{
		if (state)
		{
			try
			{
				//Zaehler = state.val;
				var body = get_login_digest.replace('$$id$$', Zaehler.toString());
				var body_out='';
				var req = HTTPRequest().request(options, function(res) 
				{
					try
					{
						SessionID = res.headers['x-clientcredentials-sessionid'].toString();
						adapter.setState('info.SessionID', SessionID, false);
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							adapter.log.debug('Login Body: ' + body_out);
							var challengeParams = JSON.parse(body_out);
							var login_digest= eNetServer_CalculateLoginDigest(challengeParams);
							Zaehler++;
							login_digest = login_digest.replace("$$id$$",Zaehler.toString());
							adapter.log.debug('Login Digest Login: ' + login_digest);
							adapter.setState('info.CounterID', Zaehler.toString(), true);
							eNetServer_SendLoginDigest(login_digest);
							adapter.setState("info.connection", true, true);
							adapter.setState("info.requestEvents", true, true);

							//eNetServer_getProject();
							//eNetServer_getScenes('','')
							eNetServer_GetLocations();
							eNetServer_RegisterSceneAction('registerEventSceneActionCreated') 
							eNetServer_RegisterSceneAction('registerEventSceneActionDeleted') 
							eNetServer_RegisterSceneAction('registerEventSceneActionChanged') 
				                        eNetServer_RegisterDeviceFunction('registerEventDeviceBatteryStateChanged','null') 

						});

						req.on('error', function(e) 
						{
							adapter.log.error('Error with request Login: ' + e.message);
							adapter.setState("info.connection", false, true);
						});
					}
					catch(e)
					{
						adapter.log.error('Error on connecting or logging in to eNet server: ' + e.message + '. Maybe you can try HTTP or non-HTTPS connection?');
						adapter.stop();
					}
				});
				req.write(body);
				req.end();
			}
			
			catch(e)
			{
				adapter.log.error('Error on connecting or logging in to eNet server: ' + e.message + '. Maybe you can try HTTP or non-HTTPS connection?');
				adapter.stop();
			}
		}
	});	
}

/*function eNetServer_getInputFTypfromOutputFTyp(pfad,InputTyp2InputID,typeID) 
{
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var reqstring='{"jsonrpc":"2.0", "method": "getInputDeviceFunctionTypeIDCorrespondingToOutputDeviceFunctionType","params":{ "outputDeviceFunctionTypeID": "$$FTyp$$"},"id":"$$id$$"}'
    var body_out = ''
	//adapter.log.info("Laenge::"+JSON.stringify(InputTyp2InputID))
	var tempSessionID = adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					CounterID = state.val;
					options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					//Zaehler = CounterID
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in = reqstring.replace('$$id$$',Zaehler.toString());
					var body_in = body_in.replace('$$FTyp$$',typeID);
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
                            //adapter.log.debug('OTyp2ITyp Body_out: ' + body_out); 
                            // hier setzen
						    var obj=JSON.parse(body_out);
                            if (obj['result']['inputDeviceFunctionTypeID'] != null)
                            {
                               // adapter.log.debug('INPUT-TYP:'+obj['result']['inputDeviceFunctionTypeID'])
                                var itypID=obj['result']['inputDeviceFunctionTypeID']
                                adapter.log.debug('setze inputUID:'+InputTyp2InputID[itypID]+'fuer Pfad:'+pfad)
                                //adapter.setObjectNotExists(pfad, {_id : adapter.namespace + pfad, type: "state", common: {name: pfad, type: "mixed", role: "value"}});
					adapter.getObject(pfad, function(err,obj)
					{
						if (err) log('Cannot read object: ' + err);
						//adapter.log.debug('OBJ-Name:'+obj.common.name)
						obj.native.Input_UID=InputTyp2InputID[itypID]
						adapter.extendObject(pfad,obj,function(err){
						if (err) log('Cannot write object (InputValue_UID: ' + err);
						})
					})
   

                            } else  {
					//adapter.log.debug('Cannot set Input_UID for:'+pfad)
			    }
						});
					    req.on('error', function(e) 
					    {
							adapter.log.error("eNet Server OTyp2Ityp " + e.message);
					    });
                    });
                    req.write(body_in);  
                    //adapter.log.debug('getINputfromOutput Pfad:'+pfad)
                    //adapter.log.debug('getINputfromOutput BODY:'+body_in)
				    req.end();
				}
			});
		}
	});
}
*/

function eNetServer_getifUIDfromofUID(pfad,oftUID) 
{
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var reqstring='{"jsonrpc":"2.0", "method": "getInputDeviceFunctionUIDCorrespondingToOutputDeviceFunction","params":{ "deviceFunctionUID": "$$typeID$$"},"id":"$$id$$"}'

    var body_out = ''
	var tempSessionID = adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					CounterID = state.val;
					options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					//Zaehler = CounterID
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in = reqstring.replace('$$id$$',Zaehler.toString());
					var body_in = body_in.replace('$$typeID$$',oftUID);
		                        //adapter.log.debug("suche NameandBody:"+typeID)
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
                            //adapter.log.debug('NameandValue Body_out: ' + body_out); 
                            // hier setzen
						    var hobj=JSON.parse(body_out);
                            if (hobj.hasOwnProperty('error')) // kommt bei Sensor vor, sollte eigentlich lt. Doku null kommen 
								{	
									//adapter.log.debug('kein IF für OF: '+pfad+'  Error: ' + hobj.error.message)
								} else 
                                {
                                if (hobj['result']['deviceFunctionUID'] != null)
                                {
                                    //adapter.log.debug('Name aendern: '+hobj['result']['name'])
			                	    //adapter.log.debug("PFAD:"+pfad)
                                    var idfUID=hobj['result']['deviceFunctionUID']
    
            		        		adapter.getObject(pfad, function(err,obj)
		        		        	    {
			        			        if (err) log('Cannot read object: ' + err);
				    		             //adapter.log.debug('OBJ-Name:'+obj.common.name)
    
	    					            obj.native.Input_UID=idfUID
		    				            adapter.extendObject(pfad,obj,function(err){
			    		    	            if (err) log('Cannot write object: ' + err);
				        		        })
					                })
                                }
                           }
				        });
					    req.on('error', function(e) 
					    {
							adapter.log.error("eNet Server OTyp2Ityp " + e.message);
					    });
                    });
                    req.write(body_in);  
                    //adapter.log.debug('NameandValue Pfad:'+pfad)
                    //adapter.log.debug('NameandValue BODY:'+body_in)
				    req.end();
				}
			});
		}
	});
}



function eNetServer_getNameAndValueTypeIDsFromDeviceFunctionType(pfad,typeID) 
{
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var reqstring='{"jsonrpc":"2.0", "method": "getNameAndValueTypeIDsFromDeviceFunctionType","params":{ "deviceFunctionTypeID": "$$typeID$$"},"id":"$$id$$"}'

    var body_out = ''
	var tempSessionID = adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					CounterID = state.val;
					options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					//Zaehler = CounterID
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in = reqstring.replace('$$id$$',Zaehler.toString());
					var body_in = body_in.replace('$$typeID$$',typeID);
		                        //adapter.log.debug("suche NameandBody:"+typeID)
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
                            //adapter.log.debug('NameandValue Body_out: ' + body_out); 
                            // hier setzen
						    var hobj=JSON.parse(body_out);
                            if (hobj['result']['name'] != null)
                            {
                                //adapter.log.debug('Name aendern: '+hobj['result']['name'])
				//adapter.log.debug("PFAD:"+pfad)
                                var name=hobj['result']['name']
				var valueTypeID=hobj['result']['valueTypeIDs'][0]
                    
					adapter.getObject(pfad, function(err,obj)
					{
						if (err) log('Cannot read object: ' + err);
						//adapter.log.debug('OBJ-Name:'+obj.common.name)
						obj.common.name=name;
						obj.native.ValueType_ID=valueTypeID
						adapter.extendObject(pfad,obj,function(err){
						if (err) log('Cannot write object: ' + err);
						})
					})
                }
						});
					    req.on('error', function(e) 
					    {
							adapter.log.error("eNet Server OTyp2Ityp " + e.message);
					    });
                    });
                    req.write(body_in);  
                    //adapter.log.debug('NameandValue Pfad:'+pfad)
                    //adapter.log.debug('NameandValue BODY:'+body_in)
				    req.end();
				}
			});
		}
	});
}


function eNetServer_getScenes(projekt,uids) 
{
	var options = 
	{
		host: adapter.config.ip,
		port: Connection_Port,
		rejectUnauthorized: false,
		path: '/jsonrpc/visualization/app_scene',
		method:'POST',
		headers: {'Content-Type': 'application/json'}
	};
    	var reqstring='{"jsonrpc":"2.0", "method":"getSceneActions", "params": {"sceneActionUIDs":[$$uids$$]}, "id":"$$id$$"}'
    	var body_out = ''
	var tempSessionID = adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			//Zaehler = CounterID
			Zaehler++;
			adapter.setState('info.CounterID', Zaehler.toString(), true);
			var body_in = reqstring.replace('$$id$$',Zaehler.toString());
			var body_in = body_in.replace('$$uids$$',uids);
		        adapter.log.debug("suche Szenen............fuer:"+projekt)
			var req = HTTPRequest().request(options, function(res) 
			{
				res.setEncoding('utf8');
				res.on('data', function (data) 
				{
					body_out += data;
				});
				res.on('end', function () 
				{
		     		    var sobj=JSON.parse(body_out);
					//adapter.log.debug("Szene:::::"+body_out)
                		    var anzScene=sobj['result']['sceneActions'].length
                    		    for (var i=0;i<anzScene;i++) 
					{
                        		var scUID=sobj['result']['sceneActions'][i]['uid']
                        		var scName=sobj['result']['sceneActions'][i]['name']
					var scstatus=sobj['result']['sceneActions'][i]['statusValue']['value']
                        		//adapter.log.debug("SzeneName:"+scName)
					if (scName.indexOf(']')> 0) // nicht vom System angelegt
                                	{
						var end=scName.indexOf(']')+1
						if ( end > 0 ) {scName=scName.substr(end,scName.length)}
						adapter.log.debug("Szene:"+scName)
                        			var pfad='Scenes.'+scName
						adapter.setObjectNotExists(pfad, {_id : adapter.namespace + pfad, type: "folder", common: {name: pfad, read: true, write: true},native: {sceneActionUID:scUID,sceneActionName:scName}});
        	                		adapter.setObjectNotExists(pfad+'.action', {_id : adapter.namespace + pfad+'.action', type: "state", common: {name: scName, type: "string", role: "value", read: true, write: true},native: {sceneUID: scUID}});
                	        		adapter.setState(pfad+'.action',  'false', true);
        	                		adapter.setObjectNotExists(pfad+'.status', {_id : adapter.namespace + pfad+'.status', type: "state", common: {name: scName, type: "string", role: "value", read: true, write: true},native: {sceneUID: scUID}});
						adapter.setState(pfad+'.status',  scstatus, true);
						sceneActionPathArray[scUID]=pfad;
						//eNetServer_RegisterSceneAction('registerEventSceneActionChanged') 
                    			}
				   	}
				});
				req.on('error', function(e) 
				    {
					adapter.log.error("eNet Szene " + e.message);
				    });
			})
               			req.write(body_in);  
		                //adapter.log.debug('NameandValue Pfad:'+pfad)
                		adapter.log.debug('Scene BODY:'+body_in)
				req.end();
		}
	})
}

function eNetServer_getProject() 
{
	var options = 
	{
		host: adapter.config.ip,
		port: Connection_Port,
		rejectUnauthorized: false,
		path: '/jsonrpc/visualization',
		method:'POST',
		headers: {'Content-Type': 'application/json'}
	};
    var reqstring='{"jsonrpc":"2.0", "method":"getCurrentProject", "params": null, "id":"$$id$$"}'
    var body_out = ''
	var tempSessionID = adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			//Zaehler = CounterID
			Zaehler++;
			adapter.setState('info.CounterID', Zaehler.toString(), true);
			var body_in = reqstring.replace('$$id$$',Zaehler.toString());
            //adapter.log.debug("lese Projet")
			var req = HTTPRequest().request(options, function(res) 
			{
				res.setEncoding('utf8');
				res.on('data', function (data) 
					{
						body_out += data;
					});
				res.on('end', function () 
					{
	     			    	var sobj=JSON.parse(body_out);
        		            	var projekt=sobj[result][projectName]
                    			projekt =projekt.replace('. ','_').replace('.','_').replace(' ','_');
    					adapter.log.debug("... jetzt noch Szenen suchen....für "+projekt);
	    				eNetServer_getScenes(projekt);
					});
                			req.on('error', function(e) 
				    	{
						adapter.log.error("eNet Server Projekt" + e.message);
                    			});
                req.write(body_in);  
                    //adapter.log.debug('NameandValue Pfad:'+pfad)
                    adapter.log.debug('getProjet BODY_in:'+body_in)
				req.end();
		    })
        }
	});
}

function normierung(form,wert) {
    if (form.indexOf("VOLT") > 0 )
        {
        return   (parseFloat(wert)/1000.).toFixed(1); 
    }
    else if (form.indexOf("LUX") > 0 )
        {
        return   parseFloat(wert).toFixed(0);
    }
    else if (form.indexOf("CURR") > 0 )
        {
        return   (parseFloat(wert)/1000.).toFixed(1);
 
    }else  {
    	return wert;
   }
 }




function eNetServer_RequestEvents() 
{
	var options = 
	{
		host: adapter.config.ip,
		port: Connection_Port,
		rejectUnauthorized: false,
		path: '/jsonrpc/visualization',
		method:'POST',
		headers: {'Content-Type': 'application/json'}
	};
        var body='';
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
			var tempZaehler = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in=request_events.replace('$$id$$',Zaehler.toString());
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
    						res.on('data', function (data) {
        						body += data;
						});
						res.on('end', function () 
						{
							try
							{
								//adapter.log.debug('RequestEvents Body: ' + body); 
								var obj=JSON.parse(body);
								if (obj.hasOwnProperty('error')) 
								   {
							           if (obj.error.code   != -29999 ) {
               								 adapter.log.debug('Request_events Error: '+obj.error.message+' '+obj.error.code)
            							   } else {
               								// DEBUG console.log ( "TimeOut-> kein change device....")
                							//request_events(); // Neustart,  -29999 = TIMEOUT, also keine events
            							   }
								} 
          							 else 
       								{
									//adapter.log.debug(body);
     							       		var i =obj['result']['events'].length
        								
  							          	for (var y=0;y<i;y++) 
									{
 							              	    adapter.log.debug('EVENT: '+obj['result']['events'][y]['event'])// valueChanged und deviceFunctionCalled
  							              	    var event =obj['result']['events'][y]['event']
									    switch (event)
									    {
   										case "deviceBatteryStateChanged": 
										{
   							                 		var deviceUID=obj['result']['events'][y]['eventData']['deviceUID']
	      							              		var batteryState=obj['result']['events'][y]['eventData']['batteryState']
 							                   		//adapter.log.debug(valueUID+'  '+value) 
 							                   		adapter.log.info('Change:'+batteryPathArray[deviceUID]+' setze auf:'+batteryState);
  							                  		adapter.setState(batteryPathArray[deviceUID],batteryState,true)//true=ACK
											break;									
										}

										case "valueChanged": 
										{
   							                 		var valueUID=obj['result']['events'][y]['eventData']['valueUID']
      							              			var value=obj['result']['events'][y]['eventData']['value']
 							                   		//adapter.log.debug(valuePathArray[valueUID]+'.value')
											if (valuePathArray[valueUID] !== 'undefined')
											{
											adapter.getObject (valuePathArray[valueUID]+'.value',function (err,obj){
                                        				            	if (obj === null) 
											{
												adapter.log.debug('ERROR value Changed: '+valueUID+' ->Object noch nicht vorhanden')
											} else {
												//var obj = adapter.getObject(valuePathArray[valueUID]+'.value') 
												//adapter.log.debug(JSON.stringify(obj))
												var form=obj.common.name
												//adapter.log.debug(form)												})
												//adapter.log.debug('Form:'+form)
					                                                	var wert=normierung(form,value)
 							                   			adapter.log.info('Change:'+valuePathArray[valueUID]+'.value  setze auf:'+wert);
  							                  			adapter.setState(valuePathArray[valueUID]+'.value',wert.toString(),true)//true=ACK
											}
											});
											}
											break;									
										}
  							              		case "sceneActionChanged": 
										{
   							                 		var sceneActionUID=obj['result']['events'][y]['eventData']['sceneActionUID']
											//adapter.log.debug('SzenenÄnderung für:'+sceneActionPathArray[sceneActionUID]);
											adapter.getStates(sceneActionPathArray[sceneActionUID] + ".*", function (err, states) 
												{
   	 											//var toDelete = [];
    												for (var id in states) 
    													{
        												//toDelete.push(id);
        												//var id = states.pop();
        												adapter.delObject(id, function (err)
        												{
            													adapter.delState(id, function (err)
            													{
            													});        
        												});                    
    												}
												adapter.delObject(sceneActionPathArray[sceneActionUID], function (err){})
												eNetServer_getScenes('','"'+sceneActionUID+'"') 
											});
											break;
									  	}
										case "sceneActionDeleted":
										{
   							                 		var sceneActionUID=obj['result']['events'][y]['eventData']['sceneActionUID']
											adapter.log.debug('Szene Löschen für:'+sceneActionPathArray[sceneActionUID]);
											adapter.getStates(sceneActionPathArray[sceneActionUID] + ".*", function (err, states) 
												{
   	 											var toDelete = [];
    												for (var id in states) 
    													{
													//adapter.log.debug('ID in States:'+id)
        												toDelete.push(id);
        												//var id = states.pop();
        												adapter.delObject(id, function (err)
        												{
            													adapter.delState(id, function (err)
            													{
            													});        
        												});                    
    												}
												adapter.delObject(sceneActionPathArray[sceneActionUID], function (err){})
											});
											break;
										}
  							              		case "sceneActionCreated":
										{
   							                 		var sceneActionUID=obj['result']['events'][y]['eventData']['sceneActionUID']
											adapter.log.debug('Szene NEU für:'+sceneActionUID);
											eNetServer_getScenes('','"'+sceneActionUID+'"')
											break;
										}
									    }

									} 
  
								}
								var tempreqevent =adapter.getState("info.requestEvents", function (err, state) 
									{
									if (state.val){
										//adapter.log.debug("requestEvents ReStart....")
										eNetServer_RequestEvents()
									} else {
										adapter.log.debug("requestEvents gestoppt....")
									}
								});
        							
							}
							catch(e)
							{
								adapter.log.error('Return from eNet Server: "' + e + '". Please try to restart the eNet server, change the connection type (HTTP/HTTPS) and check username/password!');
								adapter.stop();
							}
						});
						req.on('error', function(e) 
						{
							adapter.log.error('Error with request: ' + e.message);
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
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
	var body_out=''
	var projekt=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID =	adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				//Zaehler = state.val;
				options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
				Zaehler++;
				adapter.setState('info.CounterID', Zaehler.toString(), true);
				var body_in = get_locations.replace('$$id$$',Zaehler.toString());
				var req = HTTPRequest().request(options, function(res) 
				{
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
							adapter.log.debug('GetLocations Locations: ' + p+'#'+e+'#'+r+'#'+d + ', JSON: ' + body_out);
							for (var i=0; i<p;i++) 
							{
								var tempProjekt=obj['result']['locations'][i].name
								projekt = tempProjekt.replace('. ','_').replace('.','_').replace(' ','_');
								//erst mal putzen
								//eNetServer_delTree("Scenes");
								eNetServer_getScenes('','');
								//eNetServer_delTree(projekt);
								// jetzt neu lesen
								adapter.log.debug('GetLocations, Project: ' + projekt);
								e=obj['result']['locations'][i]['childLocations'].length
								for (var j=0;j<e;j++) 
								{
									var tempEtage=obj['result']['locations'][i]['childLocations'][j].name;
									var etage=tempEtage.replace('. ','_').replace('.','_').replace(' ','_');
									adapter.log.debug('GetLocations, Etage: ' + etage);
									r=obj['result']['locations'][i]['childLocations'][j]['childLocations'].length
									for (var k=0;k<r;k++) 
									{
										var tempRaum=obj['result']['locations'][i]['childLocations'][j]['childLocations'][k].name;
										var raum = tempRaum.replace('. ','_').replace('.','_').replace(' ','_');
										adapter.log.debug('GetLocations, Room: ' + raum);
										d=obj['result']['locations'][i]['childLocations'][j]['childLocations'][k]['deviceUIDs'].length
										for (var l=0;l<d;l++) 
										{
											adapter.log.debug('Location Object: ' + l)
											var devuid=obj['result']['locations'][i]['childLocations'][j]['childLocations'][k]['deviceUIDs'][l].deviceUID
											var devtyp=obj['result']['locations'][i]['childLocations'][j]['childLocations'][k]['deviceUIDs'][l].deviceTypeID
											var iopfad=projekt+'.'+etage+'.'+raum //+'.'+l; //l=position
											adapter.log.debug('Location Path: ' + iopfad)
											adapter.log.debug('GetLocations, Projekt: ' + projekt + ', Etage: ' + etage + ', Raum: ' + raum + ', DeviceUID: ' + devuid + ', deviceTypeID: ' + devtyp + ', Pfad: ' + iopfad);
											adapter.setObjectNotExists(iopfad, {_id : adapter.namespace + iopfad, type: "state", common: {name: iopfad, read: true, write: true},native: {Device_Type: devtyp, Device_UID: devuid}});
											eNetServer_GetDevices(iopfad,l,devtyp,devuid)

                										}
									}
								}
							}
						}
					});
					req.on('error', function(e) 
					{
						adapter.log.error('GetLocations: Error with request: ' + e.message);
					});
				});
				req.write(body_in);
				req.end();
				adapter.log.debug("... jetzt noch RequestEvents starten....");
				eNetServer_RequestEvents();
			});
		}
	});
}

function eNetServer_Register_EventValue_Change(uid,pfad) 
{
	valuePathArray[uid] = pfad.replace('UID','')
	//adapter.log.debug('PathArray:'+uid+' <->'+pfad.replace('UID',''));

	var options = {host: adapter.config.ip, 
			port: Connection_Port, 
			rejectUnauthorized: false, 	
			path: '/jsonrpc/visualization', 
			method:'POST', 
			headers: {'Content-Type': 'application/json'}
			};
    var body_out=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempZaehler = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(),true);
					var body_in=register_value_change.replace('$$id$$',Zaehler.toString());
   					body_in=body_in.replace('$$uid$$',uid);
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');

						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							adapter.log.debug('Register_Value_Change Body Out: ' + body_out);
							var obj=JSON.parse(body_out)
        				});
        
						req.on('error', function(e) 
						{
							adapter.log.error('Register_Value_Change Problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					adapter.log.debug('Register_Value_Change:'+body_in);
					req.end();
				}
			});
		}
	});
}

function eNetServer_RegisterSceneAction(ff) 
{
	var options = {host: adapter.config.ip, 
			port: Connection_Port, 
			rejectUnauthorized: false, 	
			path: '/jsonrpc/visualization/app_scene', 
			method:'POST', 
			headers: {'Content-Type': 'application/json'}
			};

	var reqstring='{"jsonrpc":"2.0", "method":"$$funk$$", "params": null, "id":"$$id$$"}'
    	var body_out=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempZaehler = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(),true);
					var body_in=reqstring.replace('$$id$$',Zaehler.toString());
   					body_in=body_in.replace('$$funk$$',ff);
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');

						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							//adapter.log.debug('Register_scene Body Out: ' + body_out);
							var obj=JSON.parse(body_out)
        				});
        
						req.on('error', function(e) 
						{
							adapter.log.error('Register_Scene Problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					adapter.log.debug('Register_Scene:'+body_in);
					req.end();
				}
			});
		}
	});
}


function eNetServer_RegisterDeviceFunction(ff,uid) 
{
	var options = {host: adapter.config.ip, 
			port: Connection_Port, 
			rejectUnauthorized: false, 	
			path: '/jsonrpc/visualization', 
			method:'POST', 
			headers: {'Content-Type': 'application/json'}
			};
	var reqstring='{"jsonrpc":"2.0", "method":"$$func$$", "params": $$uid$$, "id":"$$id$$"}'
    	var body_out=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempZaehler = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(),true);
					var body_in=reqstring.replace('$$id$$',Zaehler.toString());
   					body_in=body_in.replace('$$func$$',ff);
   					body_in=body_in.replace('$$uid$$',uid);
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');

						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							//adapter.log.debug('Register_scene Body Out: ' + body_out);
							var obj=JSON.parse(body_out)
        				});
        
						req.on('error', function(e) 
						{
							adapter.log.error('Register_DeviceFunction Problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					adapter.log.debug('Register DeviceFunction:'+body_in);
					req.end();
				}
			});
		}
	});
}



/*
function eNetServer_writeObjects(deviceUID,pfad,installArea,effectArea,deviceTypeID,deviceID,value,typeID,valueTypeID,valueUID,inputUID) 
{
    adapter.setObjectNotExists(pfad+'.EffectArea', {_id : adapter.namespace + pfad+'.EffectArea', type: "state", common: {name: pfad+'.EffectArea', type: "string", role: "value", read: true, write: true},native: {}});
	adapter.setState(pfad+'.EffectArea',effectArea,{unit: ''}); 

	adapter.setObjectNotExists(pfad+'.value', {_id : adapter.namespace + pfad+'.value', type: "state", common: {name: valueTypeID, type: "string", role: "value", read: true, write: true},native: {valueUID: valueUID}});
	adapter.setState(pfad+'.value',  value, {unit: ''});
	adapter.setState(pfad+'.valueTypeID',  valueTypeID, {unit: ''});
    
    adapter.setObject(pfad, {_id : adapter.namespace + pfad, type: "state", common: {name: pfad, type: "mixed", role: "value"},native: {Device_UID: deviceUID, Device_TypeID: deviceTypeID, Device_Type: typeID, Install_Area: installArea, ValueType_ID: valueTypeID,  Input_UID: inputUID}});
	eNetServer_getNameAndValueTypeIDsFromDeviceFunctionType(pfad,typeID) 										
 
}
*/
function eNetServer_GetDevices(pfad,pos,typ,uid) 
{
	adapter.log.debug("GetDevices Pfad: "+ pfad + ", Pos: " + pos + ", Typ: " + typ + ", UID: "+ uid);
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
	var body_out=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID =	adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in=get_devices.replace('$$id$$',Zaehler.toString());
					body_in=body_in.replace('$$devuid$$',uid)
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							//adapter.log.debug("GetDevices Body Out: " + body_out);
							var obj=JSON.parse(body_out)
							var installArea=obj['result']['devices'][0]['installationArea'];
							if (installArea !== null) 
							{
								installArea =installArea.replace(/\./g,'')
								installArea =installArea.replace(/\,/g,'_')
 								installArea =installArea.replace(/'/g,"_")
							}
							var deviceTypeID=obj['result']['devices'][0]['typeID'];
							var deviceUID=obj['result']['devices'][0]['uid'];
							var batteryState=obj['result']['devices'][0]['batteryState'];
//							Start Lese Devices	// #Sonnensensor
  	                        var endzz=obj['result']['devices'][0]['deviceChannelConfigurationGroups'].length
                            //alle KonfigGroups
                            for ( var zz=0;zz<endzz;zz++) {
                                var endch=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'].length
                                //alle Channels
                                for ( var ch=0;ch<endch;ch++) {
				    var InputTyp2InputID={}
                                    if ((obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['channelTypeID'] != 'CT_DISABLED') && (obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['channelTypeID'] != 'CT_DEVICE')) {
                                        if (batteryState !== null) {
                                        adapter.setObjectNotExists(pfad+'.'+installArea+' #'+zz+'.batteryState', {_id : adapter.namespace + pfad+'.'+installArea+' #'+zz+'.batteryState', type: "state", common: {name: "BatteryState",type: "string",role: "value",read: true,write: true}});
                                        adapter.setState(pfad+'.'+installArea+' #'+zz+'.batteryState',  batteryState,true);
					batteryPathArray[deviceUID]=pfad+'.'+installArea+' #'+zz+'.batteryState'
                                        }
					//erst mal effectArea ... als Stufe
                                        var effectArea=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['effectArea']
                                        if (effectArea !== null) 
					{
						effectArea =effectArea.replace(/\./g,'')
						effectArea =effectArea.replace(/\,/g,'_')
						effectArea =effectArea.replace(/'/g,"_")
					}
					// alle relevanten InputChannel von output ermitteln
                                        var endip=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['inputDeviceFunctions'].length
                                        for (var ip=0;ip<endip;ip++) {
					    //var InputTyp2InputID={}
					    var aktiv=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['inputDeviceFunctions'][ip]['active']
                                            //nur AKTIVe Inputs ausgeben
                                            if (aktiv) {
                                                var htypid=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['inputDeviceFunctions'][ip]['typeID']
                                                var huid=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['inputDeviceFunctions'][ip]['uid']   
                                                var pfadneu=pfad+'.'+installArea+' #'+zz+'.'+effectArea+' #'+ch+'.InputDevice'+ip
						InputTyp2InputID[htypid]=huid
                                                //adapter.log.debug('---->'+htypid+'#'+huid+'#'+pfadneu)
                                                adapter.setObject(pfadneu, {_id : adapter.namespace + pfadneu, type: "folder", common: {name: pfadneu, type: "mixed", role: "value"},native: {Device_UID: deviceUID,  Device_Type: htypid, Install_Area: installArea, ValueType_ID: 'valueTypeID',  Input_UID: huid}});
                                                adapter.setObjectNotExists(pfadneu+'.value', {_id : adapter.namespace + pfadneu, type: "state", common: {name: '*', type: "mixed", role: "value"},native: {Device_UID: deviceUID,  Device_Type: htypid, Install_Area: installArea, ValueType_ID: valueTypeID,  Input_UID: huid}});
                                                adapter.setState(pfadneu+'.value',  htypid,true); // hier war value
                                                //adapter.log.debug('HTYPID:'+htypid)
                        			eNetServer_getNameAndValueTypeIDsFromDeviceFunctionType(pfadneu,htypid) 										
                                                //adapter.log.debug("ITYP2IID:"+htypid+'#'+huid)
						devicePathArray[huid]=pfadneu
                                            }
                                        }
                                        var endop=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'].length
                                        // alle OutputChannel ermitteln
                                        for ( var op=0;op<endop;op++) {
                                            //alle Value fuer Outputchannel 
              				    var odftypeID=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['typeID'];
 	      				    var odfUID=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['uid'];    
                			    var aktiv=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['active'];
                                                if (aktiv) {
                                                var endcv=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['currentValues'].length
                                                for ( var cv=0;cv<endcv;cv++) {
                                                    //adapter.log.debug('EffectArea:'+effectArea+'#'+zz+'#'+ch+'#'+op+'#endop:'+endop+'#'+cv+'#endcv:'+endcv+'####'+deviceUID)
                    			    	    var valueTypeID=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['currentValues'][cv]['valueTypeID'];
                	    			    var valueo=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['currentValues'][cv]['value'];
                		    		    var valueUID=obj['result']['devices'][0]['deviceChannelConfigurationGroups'][zz]['deviceChannels'][ch]['outputDeviceFunctions'][op]['currentValues'][cv]['valueUID'];
                                                    var pfadneu=pfad+'.'+installArea+' #'+zz+'.'+effectArea+' #'+ch+'.OutputDevice'+op+' #'+cv
                                                    var value = normierung (valueTypeID,valueo)
						    adapter.setObjectNotExists(pfadneu, {_id : adapter.namespace + pfadneu, type: "folder", common: {name: "##", type: "mixed", role: "value"},native: {Device_UID: deviceUID, Device_TypeID: deviceTypeID, outputDeviceType_UID:odfUID, Device_Type: odftypeID, Install_Area: installArea, ValueType_ID: valueTypeID,  Input_UID: ''}});
                       				    //adapter.setObjectNotExists(pfadneu+'.EffectArea', {_id : adapter.namespace + pfadneu+'.EffectArea', type: "state", common: {name: '', type: "string", role: "value", read: true, write: true},native: {}});
                                                    //adapter.setState(pfadneu+'.EffectArea',effectArea,{unit: ''}); 
						    adapter.setObjectNotExists(pfadneu+'.value', {_id : adapter.namespace + pfadneu+'.value', type: "state", common: {name: valueTypeID, type: "string", role: "value", read: true, write: true},native: {valueUID: valueUID}});
                                                    adapter.setState(pfadneu+'.value',  value,true); 
                                                    //////adapter.setState(pfadneu+'.valueTypeID',  valueTypeID, {unit: ''});    
                                                    eNetServer_getNameAndValueTypeIDsFromDeviceFunctionType(pfadneu,odftypeID) 										
                         			    // Output valueUID registrieren fuer requests
                            		                eNetServer_Register_EventValue_Change(valueUID,pfadneu);
                                                    //InputUID fuer OutputID finden
                                                    //eNetServer_getInputFTypfromOutputFTyp(pfadneu,InputTyp2InputID,odftypeID)
						    eNetServer_getifUIDfromofUID(pfadneu,odfUID)
						    devicePathArray[odfUID]=pfadneu
                                                } 
                                            }
                                        }
                                    }   
                                }
			    }
			});
			req.on('error', function(e) 
			{
				adapter.log.error('GetDevices: Error with request: ' + e.message);
			});
		});
		req.write(body_in);
		req.end();
	     }
	  });
	}
   });
}

function eNetServer_SetState(uid,typ,wert) 
{
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var body_out=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempZaehler = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					//Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in=set_state.replace('$$id$$',Zaehler.toString());
					body_in=body_in.replace('$$UID$$',uid);
					body_in=body_in.replace('$$valueTypeID$$',typ);
					body_in=body_in.replace('$$Wert$$',wert);
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');

						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							adapter.log.debug('SetState Body Out: ' + body_out);
							var obj=JSON.parse(body_out)
        				});
        
						req.on('error', function(e) 
						{
							adapter.log.error('SetState Problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					//adapter.log.debug('SetState Body In:'+body_in);
					req.end();
				}
			});
		}
	});
}

function eNetServer_executeAction(uid) 
{
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
    var reqstring='{"jsonrpc":"2.0", "method": "executeAction","params":{ "actionUID":"$$uid$$"},"id":"$$id$$"}'
    var body_out=''
	var tempSessionID =	adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
					//Zaehler = state.val;
					options.headers={'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in=reqstring.replace('$$id$$',Zaehler.toString());
					body_in=body_in.replace('$$uid$$',uid);
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');

						res.on('data', function (data) 
						{
							body_out += data;
						});
						res.on('end', function () 
						{
							adapter.log.debug('execte Action Body Out: ' + body_out);
							var obj=JSON.parse(body_out)
        				});
        
						req.on('error', function(e) 
						{
							adapter.log.error('execute Action Problem with request: ' + e.message);
						});
					});
					req.write(body_in);
					//adapter.log.debug('SetState Body In:'+body_in);
					req.end();
		}
	});
}



function eNetServer_Logout() 
{
	adapter.log.debug("eNet Server Logout Start");
	
	var options = {host: adapter.config.ip, port: Connection_Port, rejectUnauthorized: false, path: '/jsonrpc/visualization', method:'POST', headers: {'Content-Type': 'application/json'}};
	var reqstr=[];
	//reqstr.push('{"jsonrpc":"2.0", "method":"setClientRole", "params":{"clientRole":"CR_VISU"}, "id":"$$id$$"}')
	//reqstr.push('{"jsonrpc":"2.0", "method":"registerEventConfigurationParameterChanged", "params":{"configurationUID":"90f37543-7ba6-4eb2-8481-5a58e2f255e4", "parameterID":"P_CFG_PRJ_SAVING"}, "id":"$$id$$"}')
	//reqstr.push('{"jsonrpc":"2.0", "method":"setValueToConfigurationParameter", "params":{"configurationUID":"90f37543-7ba6-4eb2-8481-5a58e2f255e4", "parameterID":"P_CFG_PRJ_SAVING", "value":true}, "id":"$$id$$"}')
	reqstr.push('{"jsonrpc":"2.0", "userLogout", "params":null, "id":"$$id$$"}')
	//reqstr.push('{"jsonrpc":"2.0", "method":"unregisterEventConfigurationParameterChanged", "params":{"configurationUID":"90f37543-7ba6-4eb2-8481-5a58e2f255e4", "parameterID":"P_CFG_PRJ_SAVING"}, "id":"$$id$$"}')
	var durchlauf = 0;
	Zaehler = 0;
    var body_out = ''
	var tempSessionID = adapter.getState("info.SessionID", function (err, state) 
	{
		if (state)
		{
			SessionID = state.val;
			var tempCounterID = adapter.getState("info.CounterID", function (err, state) 
			{
				if (state)
				{
					CounterID = state.val;
					options.headers = {'Content-Type':'application/json; charset=utf-8','Cookie':'uEhaA=true; pbAudioFalg=ON; VideoFormatAVN=ActiveX; INSTASESSIONID='+SessionID+'; downloadFinished=true; rememberMe=true'};
					Zaehler = CounterID
					Zaehler++;
					adapter.setState('info.CounterID', Zaehler.toString(), true);
					var body_in = reqstr[durchlauf].replace('$$id$$',Zaehler.toString());
					var req = HTTPRequest().request(options, function(res) 
					{
						res.setEncoding('utf8');
						res.on('data', function (data) 
						{
							body_out += data;
							if (typeof(body) !== "undefined")			
							{
								traverse(JSON.parse(body));
							}
						});
						res.on('end', function () 
						{
							if (typeof(body) !== "undefined")			
							{
								durchlauf++;
								if (durchlauf<reqstr.length)
								{
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
						adapter.setState('info.SessionID', "", true);
						adapter.setState('info.CounterID', "0", true);
						//adapter.setState('info.requestEvents', false, true);
					});
					adapter.log.debug("eNet Server Logout Request Body IN: " + body_in);
					adapter.log.info("eNet Server Logout, Tschuess ....");
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
			gw.disconnect();	})
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
			
						adapter.setObjectNotExists("scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".NAME", {					_id : adapter.namespace + "scenes.scene" + ParsedJSON.ITEMS[x].NUMBER + ".NAME",
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
								role: "scene.state"						},
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
