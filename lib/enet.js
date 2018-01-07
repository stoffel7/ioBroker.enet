"use strict";

var discover = require("./discover");
var gateway = require("./gateway");


function eNet(config) {
    this._config = config;
}

module.exports.eNet = eNet;
module.exports.discover = discover;
module.exports.gateway = gateway;
