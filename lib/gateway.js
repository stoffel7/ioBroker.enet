'use strict';

const CONNECTION_PORT = 9050;

const net = require('net');
const util = require('util');
const EventEmitter = require('events');

function gateway(config) {
    //this.idleTimeout = 3000;
    this.idleTimeout = 500;
    this.host = config.host;
    this.name = config.name || config.host;
    this.id = config.mac || config.name;

    this.client = new net.Socket();
    this.connected = false;
    this.data = '';

    this.client.on(
        'close',
        function () {
            this.connected = false;
            this.emit('gateway', null, null);
            console.log('gateway close');
        }.bind(this),
    );

    this.client.on(
        'error',
        function (err) {
            this.connected = false;
            this.emit('gateway', err, null);
            console.log('gateway error');
        }.bind(this),
    );

    this.client.on(
        'data',
        function (data) {
            this.data += data;
            var arr = this.data.split('\r\n\r\n');

            this.data = arr[arr.length - 1];

            for (var i = 0; i < arr.length - 1; ++i) {
                try {
                    var json = JSON.parse(arr[i]);

                    // Check for channel messages
                    // {"PROTOCOL":"0.03","TIMESTAMP":"08154711","CMD":"ITEM_UPDATE_IND","VALUES":[{"NUMBER":"16","VALUE":"1","STATE":"ON","SETPOINT":"255"}]}
                    if (json && json.CMD == 'ITEM_UPDATE_IND' && Array.isArray(json.VALUES)) {
                        json.VALUES.forEach(
                            function (obj) {
                                if (obj.NUMBER) {
                                    this.emit(obj.NUMBER.toString(), null, obj);
                                }
                            }.bind(this),
                        );
                    } else {
                        this.emit('gateway', null, json);
                    }
                } catch (e) {
                    this.emit('gateway', e, null);
                }
            }
        }.bind(this),
    );
}

util.inherits(gateway, EventEmitter);

module.exports = function (config) {
    return new gateway(config);
};

gateway.prototype.connect = function () {
    if (this.connected) {
        return;
    }
    if (!this.host) {
        return;
    }
    this.connected = true;

    this.client.connect(
        CONNECTION_PORT,
        this.host,
        function () {
            this.client.setTimeout(
                this.idleTimeout,
                function () {
                    this.disconnect();
                }.bind(this),
            );
        }.bind(this),
    );
};

gateway.prototype.disconnect = function () {
    this.client.end();
    this.connected = false;
};

gateway.prototype.send = function (data) {
    this.client.write(data);
};

////////////////////////////////////////////////////////////////////////////////
//
//  Gateway commands
//

gateway.prototype.getVersion = function (callback) {
    var l;

    if (callback) {
        l = new responseListener(this, 'VERSION_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"VERSION_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}"}\r\n\r\n`;
    this.client.write(msg);

    // response: {"PROTOCOL":"0.03","TIMESTAMP":"08154711","CMD":"VERSION_RES","FIRMWARE":"0.91","HARDWARE":"73355700","ENET":"45068305","PROTOCOL":"0.03"}
};

gateway.prototype.getBlockList = function (callback) {
    var l;

    if (callback) {
        l = new responseListener(this, 'BLOCK_LIST_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"BLOCK_LIST_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}","LIST-RANGE":1}\r\n\r\n`;
    this.client.write(msg);

    // response: {"PROTOCOL":"0.03","TIMESTAMP":"08154711","CMD":"BLOCK_LIST_RES","STATE":0,"LIST-RANGE":1,"LIST-SIZE":[36,227,76,35,51,313,97,13,0,0],"DATA-IDS":[1,6,1,1,1,10,1,1,0,0]}
};

gateway.prototype.getChannelInfo = function (callback) {
    var l;

    if (callback) {
        l = new responseListener(this, 'GET_CHANNEL_INFO_ALL_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"GET_CHANNEL_INFO_ALL_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}"}\r\n\r\n`;
    this.client.write(msg);

    // response: {"PROTOCOL":"0.03","TIMESTAMP":"08154711","CMD":"GET_CHANNEL_INFO_ALL_RES","DEVICES":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}
};

gateway.prototype.getProjectList = function (callback) {
    var l;

    if (callback) {
        l = new responseListener(this, 'PROJECT_LIST_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"PROJECT_LIST_GET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}"}\r\n\r\n`;
    this.client.write(msg);
};

////////////////////////////////////////////////////////////////////////////////
//
//  Channel commands
//

gateway.prototype.signOut = function (channels, callback) {
    var l;

    if (!Array.isArray(channels)) {
        callback && callback(new Error('signOut needs a channels array.'));
        return;
    }

    if (callback) {
        l = new responseListener(this, 'ITEM_VALUE_SIGN_OUT_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"ITEMS":${JSON.stringify(channels)},"CMD":"ITEM_VALUE_SIGN_OUT_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}"}\r\n\r\n`;
    this.client.write(msg);

    // response: {"PROTOCOL":"0.03","TIMESTAMP":"08154711","CMD":"ITEM_VALUE_SIGN_OUT_RES"}
};

gateway.prototype.signIn = function (channels, callback) {
    var l;

    if (!Array.isArray(channels)) {
        if (callback) {
            callback(new Error('signIn needs a channels array.'));
        }
        return;
    }

    if (callback) {
        l = new responseListener(this, 'ITEM_VALUE_SIGN_IN_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"ITEMS":${JSON.stringify(channels)},"CMD":"ITEM_VALUE_SIGN_IN_REQ","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}"}\r\n\r\n`;
    this.client.write(msg);

    // response: {"PROTOCOL":"0.03","TIMESTAMP":"08154711","CMD":"ITEM_VALUE_SIGN_IN_RES","ITEMS":[16]}
};

gateway.prototype.setValue = function (channel, on, long, callback) {
    var l;

    if (callback) {
        l = new channelResponseListener(this, channel, 'ITEM_VALUE_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}","VALUES":[{"STATE":"${on ? 'ON' : 'OFF'}"${long ? ',"LONG_CLICK":"ON"' : ''},"NUMBER":${channel}}]}\r\n\r\n`;
    //    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now()/1000)}","VALUES":[{"STATE":"${on ? "ON":"OFF"}","LONG_CLICK":"${long ? "ON":"OFF"}","NUMBER":${channel}}]}\r\n\r\n`;

    this.client.write(msg);

    // response: {"CMD":"ITEM_VALUE_RES","PROTOCOL":"0.03","TIMESTAMP":"1467998383","VALUES":[{"NUMBER":16,"STATE":"OFF"}]}
};

gateway.prototype.setValueDim = function (channel, dimVal, callback) {
    var l;

    if (callback) {
        l = new channelResponseListener(this, channel, 'ITEM_VALUE_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}","VALUES":[{"STATE":"VALUE_DIMM","VALUE":${dimVal},"NUMBER":${channel}}]}\r\n\r\n`;

    this.client.write(msg);
};

gateway.prototype.setValueBlind = function (channel, blindVal, callback) {
    var l;

    if (callback) {
        l = new channelResponseListener(this, channel, 'ITEM_VALUE_RES', callback);
    }

    if (!this.connected) {
        this.connect();
    }

    var msg = `{"CMD":"ITEM_VALUE_SET","PROTOCOL":"0.03","TIMESTAMP":"${Math.floor(Date.now() / 1000)}","VALUES":[{"STATE":"VALUE_BLINDS","VALUE":${blindVal},"NUMBER":${channel}}]}\r\n\r\n`;

    this.client.write(msg);
};

function responseListener(gateway, response, callback) {
    this.gateway = gateway;

    this.cb = function (err, msg) {
        if (err) {
            gateway.removeListener('gateway', this.cb);
            callback(err);
        } else {
            if (!msg) {
                gateway.removeListener('gateway', this.cb);
                callback(new Error('Gateway disconnected.'));
                return;
            }

            if (msg.CMD === response) {
                gateway.removeListener('gateway', this.cb);
                callback(null, msg);
            }
        }
    }.bind(this);
    gateway.on('gateway', this.cb);
}

function channelResponseListener(gateway, channel, response, callback) {
    this.gateway = gateway;
    this.listening = true;

    this.cb = function (err, msg) {
        if (err) {
            gateway.removeListener('gateway', this.cb);
            callback(err);
        } else {
            if (!msg) {
                gateway.removeListener('gateway', this.cb);
                callback(new Error('Gateway disconnected.'));
                return;
            }
            if (msg.CMD === response && Array.isArray(msg.VALUES)) {
                msg.VALUES.forEach(
                    function (obj) {
                        if (obj.NUMBER === channel.toString()) {
                            gateway.removeListener('gateway', this.cb);
                            callback(null, obj);
                        }
                    }.bind(this),
                );
            }
        }
    }.bind(this);

    gateway.on('gateway', this.cb);
}
