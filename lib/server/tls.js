'use strict';

const Client = require('../client');
const Server = require('../server');
const tls = require('tls');
const utils = require('../utils');
const uuid = require('uuid');

/**
 *  Constructor for a Jayson TLS-encrypted TCP server
 *  @class ServerTls
 *  @extends require('tls').Server
 *  @param {Server} server Server instance
 *  @param {Object} [options] Options for this instance
 *  @return {ServerTls}
 */
const TlsServer = function(server, options) {
  if (!(this instanceof TlsServer)) {
    return new TlsServer(server, options);
  }

  this.options = options;

  tls.Server.call(this, this.options, getTlsListener(this, server));
};
require('util').inherits(TlsServer, tls.Server);

module.exports = TlsServer;

function getTlsListener(self, server) {
  return function(conn) {
    conn.id = uuid.v4();
    const options = self.options || {};
    // console.log('tls listener', conn.id, options);

    // Set up a client object
    const idMap = {};
    const client = new Client({socket: conn});
    client._request = function(request, callback) {
      // Fix a jayson bug that puts a null id in notifications.
      if (request.id === null) {
        delete request.id;
      }
      utils.JSON.stringify(request, options, function(err, body) {
        if (err) {
          return callback(err);
        }

        // wont get anything for notifications, just end here.
        if (utils.Request.isNotification(request)) {
          conn.write(body);
          return callback();
        }

        // If this is not a notification, wait for a response.
        idMap[request.id] = callback;

        conn.write(body+'\n');
      });
    };
    conn.on('error', function(err) {
      // console.log('conn.error()', conn.id, err);
      Object.keys(idMap).forEach(id => {idMap[id](err); delete idMap[id];});
    });
    conn.on('end', function() {
      // console.log('conn.end()', conn.id);
      Object.keys(idMap).forEach(id => {idMap[id](); delete idMap[id];});
    });
    /*
    conn.on('close', function() {
      console.log('conn.close()', conn.id);
    });
    conn.on('data', function(data) {
      console.log(`conn.data() ${conn.id} ${data}`);
    }); */

    // Create a persistent context for this connection -- prepopulate with
    // the client object for this connection and the connection itself.
    const context = {client, conn};

    // Parse incoming packets and direct them to the client or server
    utils.parseStream(conn, options, function(err, request) {
      if (err) {
        return respondError(err);
      }

      if (utils.Response.isValidResponse(request)) {
        // console.log('is a valid response');
        if (idMap.hasOwnProperty(request.id)) {
          idMap[request.id](null, request);
          delete idMap[request.id];
        }
      } else {
        // console.log('server.call: ', request.method, request.params);
        server.call(request, context, function(error, success) {
          const response = error || success;
          if (response) {
            utils.JSON.stringify(response, options, function(err, body) {
              if (err) return respondError(err);
              conn.write(body+'\n');
            });
          }
        });
      }
    });

    // ends the request with an error code
    function respondError(err) {
      const error = server.error(Server.errors.PARSE_ERROR, null, String(err));
      const response = utils.response(error, undefined, undefined, self.options.version);
      utils.JSON.stringify(response, options, function(err, body) {
        if (err) {
          body = ''; // we tried our best.
        }
        conn.write(body+'\n');
      });
      Object.keys(idMap).forEach(id => {idMap[id](); delete idMap[id];});
    }

  };
}
