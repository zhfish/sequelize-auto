var Sequelize = require('sequelize')
  , async = require('async')
  , fs = require('fs');

module.exports = (function(){
  var AutoSequelize = function(database, username, password, options) {
    this.sequelize = new Sequelize(database, username, password, options || {});
    this.queryInterface = this.sequelize.getQueryInterface();
    this.options = {};
  }

  AutoSequelize.prototype.run = function(options, callback) {
    var self = this
      , text = {};

    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    options.global = options.global || 'Sequelize';
    options.local = options.local || 'sequelize';
    options.spaces = options.spaces || false;
    options.indentation = options.indentation || 1;
    options.directory = options.directory || './models';

    self.options = options;

    this.sequelize.query(this.queryInterface.QueryGenerator.showTablesQuery(), { type: self.sequelize.QueryTypes.SELECT, raw: true})
    .then(function(tables){
      var _tables = {};

      async.each(tables, function(table, _callback){
        var tableName, tableSchema, tableKeys;
        tableName = Array.isArray(table) ? table[0] : table;

        if (typeof table === "object") {
          tableKeys = Object.keys(table);
          tableName = table[tableKeys]
        }

        if(self.sequelize.options.dialect === 'mssql'){
          tableSchema = tableName['TABLE_SCHEMA'];
          tableName = tableName['TABLE_NAME'];
        }

        self.queryInterface.describeTable(tableName, tableSchema)
          .then(function(fields){
            _tables[tableName] = fields;
            _callback(null);
          });
      }, function(){
        var tableNames = Object.keys(_tables);
        async.each(tableNames, function(table, _callback){
          var fields = Object.keys(_tables[table])
            , spaces = '';

          for (var x = 0; x < options.indentation; ++x) {
            spaces += (options.spaces === true ? ' ' : "\t");
          }

          text[table] = "/* jshint indent: " + options.indentation + " */\n\n";
          text[table] += "module.exports = function(sequelize, DataTypes) {\n";
          text[table] += spaces + "return sequelize.define('" + table + "', {\n";

          fields.forEach(function(field, i){
            text[table] += spaces + spaces + field + ": {\n";
            var fieldAttr = Object.keys(_tables[table][field]);
            // Serial key for postgres...
            var defaultVal = _tables[table][field].defaultValue;

            if (Sequelize.Utils._.isString(defaultVal) && defaultVal.toLowerCase().indexOf('nextval') !== -1 && defaultVal.toLowerCase().indexOf('regclass') !== -1) {
              text[table] += spaces + spaces + spaces + "type: DataTypes.INTEGER,\n";
              text[table] += spaces + spaces + spaces + "primaryKey: true\n";
            } else {
              // ENUMs for postgres...
              if (_tables[table][field].type === "USER-DEFINED" && !!_tables[table][field].special) {
                _tables[table][field].type = "ENUM(" + _tables[table][field].special.map(function(f){ return "'" + f + "'"; }).join(',') + ")";
              }

              fieldAttr.forEach(function(attr, x){
                // We don't need the special attribute from postgresql describe table..
                if (attr === "special") {
                  return true;
                }

                if (attr === "primaryKey") {
                  if (_tables[table][field][attr] === true) // && self.sequelize.options.dialect !== "postgres")
                    text[table] += spaces + spaces + spaces + "primaryKey: true";
                  else return true
                }
                else if (attr === "allowNull") {
                  text[table] += spaces + spaces + spaces + attr + ": " + _tables[table][field][attr];
                }
                else if (attr === "defaultValue") {
                  var val_text = defaultVal;
                  if (Sequelize.Utils._.isString(defaultVal)) {
                    val_text = "'" + val_text + "'"
                  }
                  if(defaultVal === null) {
                    return true;
                  } else {
                    text[table] += spaces + spaces + spaces + attr + ": " + val_text;
                  }
                }
                else if (attr === "type" && _tables[table][field][attr].indexOf('ENUM') === 0) {
                  text[table] += spaces + spaces + spaces + attr + ": DataTypes." + _tables[table][field][attr];
                } else {
                  var _attr = (_tables[table][field][attr] || '').toLowerCase();
                  var val = "'" + _tables[table][field][attr] + "'";
                  if (_attr === "tinyint(1)" || _attr === "boolean") {
                    val = 'DataTypes.BOOLEAN';
                  }
                  else if (_attr.match(/^(smallint|mediumint|tinyint|int)/)) {
                    var length = _attr.match(/\(\d+\)/);
                    val = 'DataTypes.INTEGER' + (!!length ? length : '');
                  }
                  else if (_attr.match(/^bigint/)) {
                    val = 'DataTypes.BIGINT';
                  }
                  else if (_attr.match(/^string|varchar|varying|nvarchar/)) {
                    val = 'DataTypes.STRING';
                  }
                  else if (_attr.match(/text|ntext$/)) {
                    val = 'DataTypes.TEXT';
                  }
                  else if (_attr.match(/^(date|time)/)) {
                    val = 'DataTypes.DATE';
                  }
                  else if (_attr.match(/^(float|float4)/)) {
                    val = 'DataTypes.FLOAT';
                  }
                  else if (_attr.match(/^decimal/)) {
                    val = 'DataTypes.DECIMAL';
                  }
                  else if (_attr.match(/^(float8|double precision)/)) {
                    val = 'DataTypes.DOUBLE';
                  }
                  else if (_attr.match(/^uuid/)) {
                    val = 'DataTypes.UUIDV4';
                  } 
                  else if (_attr.match(/^json/)) {
                    val = 'DataTypes.JSON';
                  }
                  else if (_attr.match(/^jsonb/)) {
                    val = 'DataTypes.JSONB';
                  }
                  else if (_attr.match(/^geometry/)) {
                    val = 'DataTypes.GEOMETRY';
                  }
                  text[table] += spaces + spaces + spaces + attr + ": " + val;
                }

                text[table] += ",";
                text[table] += "\n";
              });
            }

            // removes the last `,` within the attribute options
            text[table] = text[table].trim().replace(/,+$/, '') + "\n";

            text[table] += spaces + spaces + "}";
            if ((i+1) < fields.length) {
              text[table] += ",";
            }
            text[table] += "\n";
          });

          text[table] += spaces + "}";

          //conditionally add additional options to tag on to orm objects
          var hasadditional = typeof options.additional === "object" && Object.keys(options.additional).length > 0;
          if(hasadditional) {

            text[table]  += ", {\n";
            for(var additional in options.additional) {
              text[table] += spaces + spaces + additional + ": " + options.additional[additional] + ",\n";
            }
            text[table] = text[table].substring(0, text[table].length -1);
            text[table] += "\n" + spaces + "}";
          }

          //resume normal output
          text[table] += ");\n};\n";
          _callback(null);
        }, function(){
          self.sequelize.close();

          self.write(text, callback);
        });
      });
    })
  }

  AutoSequelize.prototype.write = function(attributes, callback) {
    var tables = Object.keys(attributes)
      , self = this;

    async.series([
      function(_callback){
        fs.lstat(self.options.directory, function(err, stat){
          if (err || !stat.isDirectory()) {
            fs.mkdir(self.options.directory, _callback);
          } else {
            _callback(null);
          }
        })
      }
    ], function(err){
      if (err) return callback(err);

      async.each(tables, function(table, _callback){
        fs.writeFile(self.options.directory + '/' + table + '.js', attributes[table], function(err){
          if (err) return _callback(err);
          _callback(null);
        });
      }, function(err){
        callback(err, null);
      });
    });
  }

  return AutoSequelize;
})();
