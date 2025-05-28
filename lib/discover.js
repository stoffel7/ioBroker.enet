/* eslint-disable jsdoc/no-blank-blocks */
'use strict';

const dgram = require('dgram');
const util = require('util');
const EventEmitter = require('events');

const DISCOVERY_BROADCAST_LISTEN_PORT = 2906;
const DISCOVERY_BROADCAST_PORT = 3112;
const DISCOVERY_PAYLOAD_MSG = 'Ich wusste, dass Sie zurueck kommen wuerden...\0\x02';
const DISCOVERY_TIMER_INTERVAL = 3000;
const DISCOVERY_TIMER_COUNT = 3;

function byteToHex(byte) {
    return (byte >>> 4).toString(16) + (byte & 0xf).toString(16);
}

/**
 *
 */
function discover() {}

util.inherits(discover, EventEmitter);

module.exports = discover;

discover.prototype.discover = function (callback) {
    var broadcast = dgram.createSocket('udp4');
    var gateways = [];

    broadcast.on('error', err => {
        clearInterval(iVal);
        broadcast.close();
        callback(err);
    });

    broadcast.on(
        'message',
        function (msg, _rinfo) {
            var n = msg.length;

            if (n < 15) {
                console.log(`message too small. ${msg.length}`);
                return;
            }

            // Gate response:
            // message size n
            // 1 byte unknown
            // 2 bytes LE == 65199
            // 4 bytes IP
            // n-15 bytes Name
            // 6 bytes Mac-Address
            // 1 byte DeviceState
            // 1 byte Manufacturer
            // 1 byte unknown

            var macaddress = `${byteToHex(msg.readUInt8(msg.length - 8))}:${byteToHex(
                msg.readUInt8(msg.length - 7),
            )}:${byteToHex(msg.readUInt8(msg.length - 6))}:${byteToHex(msg.readUInt8(msg.length - 5))}:${byteToHex(
                msg.readUInt8(msg.length - 4),
            )}:${byteToHex(msg.readUInt8(msg.length - 3))}`;

            if (
                !gateways.find(function (gw) {
                    return gw.mac === macaddress;
                })
            ) {
                var gw = {
                    messageLength: msg.readUInt8(0), // must be msg.length
                    magic65199: msg.readUInt16LE(1), // must be 65199
                    host: `${msg.readUInt8(3).toString()}.${msg.readUInt8(4).toString()}.${msg
                        .readUInt8(5)
                        .toString()}.${msg.readUInt8(6).toString()}`,
                    name: msg.slice(7, -9).toString(),
                    mac: macaddress,
                    deviceState: msg.readUInt8(msg.length - 2),
                    manufacturer: msg.readUInt8(msg.length - 1),
                };

                if (msg.length < gw.messageLength) {
                    console.log('Recieved incolmplete discovery reaponse.');
                } else if (gw.magic65199 != 65199) {
                    console.log('Recieved corrupt/unknown discovery reaponse.');
                } else {
                    this.emit('discover', gw);
                    console.log('Discovering');
                    gateways.push(gw);
                }
            }
        }.bind(this),
    );

    var message = new Buffer(DISCOVERY_PAYLOAD_MSG);

    var count = 0;
    var iVal;

    broadcast.bind(DISCOVERY_BROADCAST_LISTEN_PORT, function () {
        broadcast.setBroadcast(true);
        broadcastNew();
        iVal = setInterval(broadcastNew, DISCOVERY_TIMER_INTERVAL);
    });

    function broadcastNew() {
        if (++count > DISCOVERY_TIMER_COUNT) {
            clearInterval(iVal);
            broadcast.close();
            callback(null, gateways);
            return;
        }

        broadcast.send(message, 0, message.length, DISCOVERY_BROADCAST_PORT, '255.255.255.255', err => {
            if (err) {
                clearInterval(iVal);
                broadcast.close();
                callback(err);
            }
        });
    }
};
