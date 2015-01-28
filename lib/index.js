var http = require('http'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    StreamReader = require('./StreamReader');

/**
 * Extend target object from source object
 * @param {Object} target Target object
 * @param {Object} source Source object
 * @returns {Object} Returns extended object
 * @private
 */
function _extend(target, source) {
    var keys = Object.keys(source);

    for (var i = 0; i < keys.length; i++) {
        target[keys[i]] = source[keys[i]];
    }

    return target;
}

/**
 * Default options
 * @description :: Default configuration object for RadioParser
 * @type {Object}
 * @private
 */
var DEFAULT_OPTIONS = {
    keepListen: false,
    autoUpdate: true,
    errorInterval: 10 * 60,
    emptyInterval: 5 * 60,
    metadataInterval: 5
};

util.inherits(RadioParser, EventEmitter);

/**
 * RadioParser class
 * @param {Object|String} options Configuration object or string with radio station URL
 * @constructor
 */
function RadioParser(options) {
    EventEmitter.call(this);

    if (typeof options === 'string') {
        this.setConfig({
            url: options
        });
    } else {
        this.setConfig(options);
    }

    this.queueRequest();
}

/**
 * When request to radio station is successful this function is called
 * @param response
 * @returns {RadioParser}
 * @private
 */
RadioParser.prototype._onRequestResponse = function (response) {
    var self = this,
        icyMetaInt = response.headers['icy-metaint'];

    if (icyMetaInt) {
        var reader = new StreamReader(icyMetaInt);
        reader.on('metadata', function (metadata) {
            self._destroyResponse(response);
            self._queueNextRequest(self.getConfig('metadataInterval'));
            self.emit('metadata', metadata);
        });
        response.pipe(reader);
        self.emit('stream', reader);
    } else {
        self._destroyResponse(response);
        self._queueNextRequest(self.getConfig('emptyInterval'));
        self.emit('empty');
    }

    return this;
};

/**
 * Called when socket connection is appears in request
 * @param socket
 * @returns {RadioParser}
 * @private
 */
RadioParser.prototype._onSocketResponse = function (socket) {
    var HTTP10 = new Buffer('HTTP/1.0'),
        socketOnData = socket.ondata;

    function onData(chunk) {
        if (/icy/i.test(chunk.slice(0, 3))) {
            var result = new Buffer(chunk.length - 'icy'.length + HTTP10.length),
                targetStart = HTTP10.copy(result);

            chunk.copy(result, targetStart, 3);
            chunk = result;
        }

        return chunk;
    }

    socket.ondata = function (buffer, start, length) {
        var chunk = onData(buffer.slice(start, length));

        socket.ondata = socketOnData;
        socket.ondata(chunk, 0, chunk.length);
    };

    return this;
};

/**
 * Called when some error in request is appears
 * @param error
 * @returns {RadioParser}
 * @private
 */
RadioParser.prototype._onRequestError = function (error) {
    this._queueNextRequest(this.getConfig('errorInterval'));
    this.emit('error', error);
    return this;
};

/**
 * Make request to radio station and get stream
 * @private
 */
RadioParser.prototype._makeRequest = function () {
    var request = http.request(this.getConfig('url'));
    request.setHeader('Icy-MetaData', '1');
    request.setHeader('User-Agent', 'Mozilla');
    request.once('response', this._onRequestResponse.bind(this));
    request.once('socket', this._onSocketResponse.bind(this));
    request.once('error', this._onRequestError.bind(this));
    request.end();

    return this;
};

/**
 * Check if response can be destroyed
 * @param {IncomingMessage} response
 * @returns {RadioParser}
 * @private
 */
RadioParser.prototype._destroyResponse = function (response) {
    if (!this.getConfig('keepListen')) {
        response.destroy();
    }

    return this;
};

/**
 * Queue next request with checking if next request is needed
 * @param {Number} [timeout] Timeout in seconds for next request
 * @returns {RadioParser}
 * @private
 */
RadioParser.prototype._queueNextRequest = function (timeout) {
    timeout = timeout || this.getConfig('errorInterval');

    if (this.getConfig('autoUpdate') && !this.getConfig('keepListen')) {
        this.queueRequest(timeout);
    }

    return this;
};

/**
 * Queue request to radio station after some time
 * @param {Number} [timeout] Timeout in seconds
 * @returns {RadioParser}
 */
RadioParser.prototype.queueRequest = function (timeout) {
    timeout = timeout || 0;

    setTimeout(this._makeRequest.bind(this), timeout * 1000);

    return this;
};

/**
 * Get configuration object or configuration value by key
 * @param {String} [key] Key name
 * @returns {*} Returns appropriate value by key or configuration object
 */
RadioParser.prototype.getConfig = function (key) {
    if (key) {
        return this._config[key];
    } else {
        return this._config;
    }
};

/**
 * Set configuration object or set configuration key with new value
 * @param {Object} config New configuration object
 * @returns {RadioParser}
 */
RadioParser.prototype.setConfig = function (config) {
    if (!this._config) {
        var defaultConfig = _extend({}, DEFAULT_OPTIONS);
        this._config = _extend(defaultConfig, config);
    } else {
        this._config = _extend(this._config, config);
    }

    return this;
};

module.exports = RadioParser;