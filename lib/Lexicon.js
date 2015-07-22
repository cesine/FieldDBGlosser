(function(exports) {
  /* globals FieldDB, alert */

  var LocalFieldDB;
  try {
    var ObservableDOM = require("frb/dom"); // add support for content editable
  } catch (e) {
    console.warn("Warning contentEditable won't work because : \n", e.stack, "\n\n");
  }
  try {
    if (FieldDB) {
      LocalFieldDB = FieldDB;
    }
  } catch (e) {
    LocalFieldDB = undefined;
  }

  var Bindings = exports.Bindings || require("frb/bindings");
  var SortedSet = exports.SortedSet || require("collections/sorted-set");
  var UniqueSet = exports.Set || require("collections/set");
  var CORS = LocalFieldDB ? LocalFieldDB.CORS : {
    makeCORSRequest: function(options) {
      console.warn("FieldDB is not loaded. This app cannot make HTTP requests to servers.", options);
      alert("FieldDB is not loaded. This app cannot make HTTP requests to servers. Please notify this app's developers.");
      return {};
    }
  };
  var Q = LocalFieldDB ? LocalFieldDB.Q : require("q");
  var BASE_LEXICON_NODE = LocalFieldDB ? LocalFieldDB.Datum : Object;

  var escapeRegexCharacters = function(regex) {
    return regex.replace(/([()[{*+.$^\\|?])/g, '\\$1');
  };

  var LexiconNode = function(options) {
    options = options || {};
    options.igt = options.igt || {};
    for (var property in options) {
      if (options.hasOwnProperty(property)) {
        this[property] = options[property];
      }
    }
    this.fossil = JSON.parse(JSON.stringify(options.igt));
    BASE_LEXICON_NODE.call(this);
  };

  LexiconNode.prototype = Object.create(BASE_LEXICON_NODE.prototype, {
    constructor: {
      value: LexiconNode
    },
    equals: {
      value: function(b) {
        var a = this;
        var equal = false;
        var fieldIndex,
          field,
          tmpArray;

        if (!a.igt || !b.igt) {
          equal = false;
          return equal;
        }

        for (fieldIndex in this.expandedIGTFields) {
          field = this.expandedIGTFields[fieldIndex];
          if (a.igt.hasOwnProperty(field)) {
            // console.log(a);
            if (a.igt[field] === b.igt[field]) {
              equal = true;
            }
          }
        }
        // If the nodes are "equal" then make sure they have the same combineFieldsIfEqual
        if (equal) {
          for (fieldIndex in this.combineFieldsIfEqual) {
            field = this.combineFieldsIfEqual[fieldIndex];
            if (a.hasOwnProperty(field)) {
              tmpArray = [];
              a[field] = a[field].concat(b[field]);
              /*jshint loopfunc: true */
              a[field].map(function(item) {
                if (tmpArray.indexOf(item) === -1) {
                  tmpArray.push(item);
                }
              });
              a[field] = tmpArray;
              b[field] = tmpArray;
            }
          }
          if (a.confidence && b.confidence) {
            a.confidence = (parseFloat(a.confidence, 10) + parseFloat(b.confidence, 10)) / 2;
            b.confidence = a.confidence;
          }
          if (a.allomorphs || b.allomorphs) {
            var allomorphs = a.allomorphs ? a.allomorphs : "";
            allomorphs = allomorphs + allomorphs ? ", " : "";
            allomorphs = allomorphs + b.allomorphs ? b.allomorphs : "";
            a.allomorphs = allomorphs;
            b.allomorphs = allomorphs;
          }
        }
        return equal;
      }
    },
    igt: {
      configurable: true,
      get: function() {
        return this.fields;
      },
      set: function(value) {
        this.fields = value;
      }
    },
    expandedIGTFields: {
      value: ["morphemes", "gloss", "allomorphy", "phonetic", "orthography"]
    },
    combineFieldsIfEqual: {
      value: ["datumids", "utteranceContext"]
    },
    sortBy: {
      value: "morphemes",
      writable: true
    },
    compare: {
      value: function(b) {
        var a = this;
        var result = 0;
        if (!b || !b.igt || !b.igt[this.sortBy]) {
          return -1;
        }
        if (!a || !a.igt || !a.igt[this.sortBy]) {
          return 1;
        }
        if ((typeof(a.igt[this.sortBy]) === 'number') && (typeof(b.igt[this.sortBy]) === 'number')) {
          result = a.igt[this.sortBy] - b.igt[this.sortBy];
        } else if ((typeof(a.igt[this.sortBy]) === 'string') && (typeof(b.igt[this.sortBy]) === 'string')) {
          if (a.igt[this.sortBy] < b.igt[this.sortBy]) {
            result = -1;
          } else if (a.igt[this.sortBy] > b.igt[this.sortBy]) {
            result = 1;
          } else {
            result = 0;
          }
        } else if (typeof(a.igt[this.sortBy]) === 'string') {
          result = 1;
        } else {
          result = -1;
        }
        return result;
      }
    },
    clean: {
      value: function() {
        // console.log("Preparing datum with this lexical entry to be cleaned...");
        var deffered = Q.defer();
        this.cleanedData = [];
        var promises = [];
        var self = this;
        this.proposedChanges = [];

        var successFunction = function(doc) {
          // console.log(doc);
          doc.datumFields.map(function(datumField) {
            if (self.fossil[datumField.label] !== self.igt[datumField.label] && (new RegExp(escapeRegexCharacters(self.fossil[datumField.label]), "i")).test(datumField.mask)) {
              var change = {
                before: datumField.mask + ""
              };
              // TODO this makes things lower case... because part of the map reduce seems to be doing that...
              datumField.mask = datumField.mask.replace(new RegExp(escapeRegexCharacters(self.fossil[datumField.label]), "ig"), self.igt[datumField.label]);
              datumField.value = datumField.mask;
              change.after = datumField.mask;
              self.proposedChanges.push(change);
              return datumField;
            }
          });
          self.cleanedData.push(doc);
        };
        var failFunction = function(reason) {
          console.log(reason);
          if (LocalFieldDB && LocalFieldDB.FieldDBObject && typeof LocalFieldDB.FieldDBObject.bug === "function") {
            LocalFieldDB.FieldDBObject.bug("There was a problem saving your changes. " + reason.reason);
          }
        };

        for (var idIndex = 0; idIndex < this.datumids.length; idIndex++) {
          // console.log(this.datumids.length[idIndex]);
          promises[idIndex] = CORS.makeCORSRequest({
            method: 'GET',
            dataType: 'json',
            url: this.url + "/" + this.datumids[idIndex]
          });
          promises[idIndex].then(successFunction).fail(failFunction);
        }
        Q.allSettled(promises).then(function(results) {
          deffered.resolve(self.proposedChanges);
        });
        return deffered.promise;
      }
    },
    save: {
      value: function() {
        var deffered = Q.defer(),
          self = this,
          promises = [];

        console.log("Saving cleaned datum...");
        while (this.cleanedData && this.cleanedData.length > 0) {
          var cleanedDatum = this.cleanedData.pop();
          promises.push(CORS.makeCORSRequest({
            method: 'PUT',
            dataType: 'json',
            data: cleanedDatum,
            url: this.url + "/" + cleanedDatum._id
          }));
        }
        Q.allSettled(promises).then(function(results) {
          deffered.resolve(results);
          self.unsaved = true;
        });
        return deffered.promise;
      }
    },
    unsaved: {
      configurable: true,
      get: function() {
        if (this._unsaved) {
          return this._unsaved;
        }
        if (this.fossil && !this.equals({
            igt: this.fossil
          })) {
          this._unsaved = true;
        }
        return this._unsaved;
      },
      set: function(value) {
        this._unsaved = value;
      }
    }
  });


  var Lexicon = function(values, equals, compare, getDefault) {
    // console.log("\tConstructing Lexicon... ");
    // SortedSet.apply(this, [values, equals, compare, getDefault]);
    SortedSet.apply(this, Array.prototype.slice.call(arguments, 1));
    // if (!compare) {
    //   this.contentCompare = this.__proto__.igtCompare;
    // }
    // if (!equals) {
    //   this.contentEquals = this.__proto__.igtEqual;
    // }
  };

  Lexicon.prototype = Object.create(SortedSet.prototype, {
    constructor: {
      value: Lexicon
    },
    sortBy: {
      value: "morphemes"
    },

    // wordFrequencies: {
    //   get: function() {
    //     console.warn(" getting wordFrequencies");
    //     if (this._wordFrequencies && this._wordFrequencies.length > 0) {
    //       return this._wordFrequencies;
    //     }
    //     var arrayOfEntries = [];
    //     this.forEach(function(entry) {
    //       entry.count = entry.datumids ? entry.datumids.length : 1;
    //       arrayOfEntries.push(entry);
    //     });
    //     this._wordFrequencies = arrayOfEntries;
    //   },
    //   set: function(value) {
    //     this._wordFrequencies = value;
    //   }
    // },

    // nonContentWordsArray: {
    //   get: function() {
    //     console.warn(" getting wordFrequencies");
    //     if (this._nonContentWordsArray && this._nonContentWordsArray.length > 0) {
    //       return this._nonContentWordsArray;
    //     }
    //     var arrayOfEntries = [];
    //     this.forEach(function(entry) {
    //       if ((entry.categories && entry.categories.indexOf("functionalWord") > -1) || entry.utterance.length > 4) {
    //         entry.count = entry.datumids ? entry.datumids.length : 1;
    //         arrayOfEntries.push(entry);
    //       } else {
    //         console.log("This morpheme is probably contentful ", entry);
    //       }
    //     });
    //     this._nonContentWordsArray = arrayOfEntries;
    //   },
    //   set: function(value) {
    //     this._nonContentWordsArray = value;
    //   }
    // },

    getLexicalEntries: {
      value: function(lexicalEntryToMatch) {
        var deffered = Q.defer(),
          matches = [],
          self = this;

        if (!lexicalEntryToMatch) {
          deffered.resolve(matches);
        } else {
          this.filter(function(value, key, object, depth) {
            // console.log(key + " of " + self.length);
            if (typeof lexicalEntryToMatch.equals === "function") {
              if (lexicalEntryToMatch.equals(value)) {
                matches.push(value);
                // console.log(value);
              }
            } else {
              var howWellDoesThisMatch = 0;
              lexicalEntryToMatch = lexicalEntryToMatch.trim();
              for (var attr in value.igt) {
                if (value.igt.hasOwnProperty(attr) && value.igt[attr] === lexicalEntryToMatch) {
                  howWellDoesThisMatch = howWellDoesThisMatch + 1;
                }
              }
              if (howWellDoesThisMatch > 0) {
                matches.push(value);
                // console.log(value);
              }
            }
            if (key === self.length - 1) {
              deffered.resolve(matches);
            }
          }, this);
        }
        return deffered.promise;
      }
    },

    bindToView: {
      value: function() {
        var lexicalEntriesElement,
          binding,
          bindings = [],
          listElement,
          entryvalue,
          entrykey,
          iterate,
          entryIndex,
          listItemView,
          fieldLabelElement,
          fieldDTElement,
          fieldDDElement,
          fieldElement,
          fieldList,
          headword,
          saveButton,
          contexts,
          field,
          classList;

        var self = this;
        lexicalEntriesElement = this.lexicalEntriesElement;
        if (!lexicalEntriesElement) {
          return;
        }
        if (!self.localDOM) {
          return;
        }
        listElement = self.localDOM.createElement("ul");
        lexicalEntriesElement.appendChild(listElement);

        this.forEach(function(entry) {
          var discussion,
            field;

          if (entry.igt && entry.igt.morphemes === "@") {
            return;
          }
          var cleanAndSaveIfChanged = function(e) {
            var result = e.target.parentElement.__data__.clean().then(function(proposedChanges) {
              if (proposedChanges.length > 0) {
                var changesAsStrings = [];
                proposedChanges.map(function(change) {
                  changesAsStrings.push(change.before + " -> " + change.after);
                });
                var saveEditToAllData = window.confirm("Would you like to clean this lexical entry? (This will change all examples you see here to have this new information.)\n\n" + changesAsStrings.join("\n"));
                if (saveEditToAllData) {
                  e.target.parentElement.__data__.save().then(function(result) {
                    console.log("Saving success...", result);
                  }).fail(function(reason) {
                    console.log("Saving failed...", reason);
                  });
                }
              }
            });

          };
          var toggleEditMode = function(e) {
            /* If the user clicks on edit, they can investigate its data in the console */
            if (!e || !e.target || !e.target.__data__) {
              return;
            }
            /* Create the json View if its not there, otherwise toggle its hidden */
            if (!e.target.jsonView) {
              e.target.jsonView = self.localDOM.createElement("textarea");
              e.target.appendChild(e.target.jsonView);
              e.target.jsonView.classList.add("lexiconJSON");
              discussion.hidden = !discussion.hidden;
            } else {
              cleanAndSaveIfChanged(e);
              discussion.hidden = !discussion.hidden;
              e.target.jsonView.hidden = discussion.hidden;
            }
            /* If jsonView is becomming hidden, save its values to the data, otherwise, fill it with the current data */
            if (e.target.jsonView.hidden) {
              var newIgt;
              try {
                for (var field in newIgt) {
                  if (newIgt.hasOwnProperty(field)) {
                    // e.target.__data__.igt[field] = newIgt[field];
                  }
                }
              } catch (except) {
                console.warn("Invalid JSON " + e.target.jsonView.innerHTML, except);
              }
            } else {
              e.target.jsonView.innerHTML = JSON.stringify(e.target.__data__.igt, null, 2);
            }
            window.currentlySelectedNode = e.target;
            console.log(window.currentlySelectedNode.__data__);
          };

          listItemView = self.localDOM.createElement("li");
          listItemView.__data__ = entry;
          listItemView.style.opacity = listItemView.__data__.igt.confidence;
          listItemView.classList.add("lexical-entry");
          listItemView.classList.add("scrollable");
          if (listItemView.__data__.igt.morphemes) {
            listItemView.id = listItemView.__data__.igt.morphemes;
          }
          // console.log("\tCreating Node view for " + listItemView.id);

          headword = self.localDOM.createElement("span");
          headword.contentEditable = 'true';
          headword.classList.add("headword");
          headword.setAttribute("title", "CLick to edit the headword of your lexical entry");
          listItemView.__data__.igt.headword = listItemView.__data__.igt.headword || listItemView.__data__.igt.morphemes ? listItemView.__data__.igt.morphemes : listItemView.__data__.igt.gloss;

          saveButton = self.localDOM.createElement("button");
          saveButton.classList.add("btn");
          saveButton.setAttribute("title", "Click here to save");
          saveButton.innerHTML = "Save ";
          saveButton.onclick = cleanAndSaveIfChanged;

          contexts = self.localDOM.createElement("span");
          contexts.classList.add("utteranceContext");

          discussion = self.localDOM.createElement("span");
          discussion.contentEditable = 'true';
          discussion.classList.add("discussion");
          discussion.hidden = true;
          listItemView.__data__.igt.discussion = listItemView.__data__.igt.discussion || "Lorem ipsum dolor sit amet, consectetur adipisicing elit, ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";
          listItemView.ondblclick = toggleEditMode;

          fieldList = self.localDOM.createElement("dl");

          var component = {
            listItemView: listItemView,
            saveButtonView: saveButton,
            headwordView: headword,
            contextsView: contexts,
            discussionView: discussion,
            fieldListView: fieldList,
            fieldViews: {},
            data: entryvalue
          };

          for (field in listItemView.__data__.igt) {
            if (listItemView.__data__.igt.hasOwnProperty(field)) {
              if (field === "discussion" || field === "headword") {
                continue;
              }
              try {
                headword.classList.add(field + ":" + listItemView.__data__.igt[field]);
                discussion.classList.add(field + ":" + listItemView.__data__.igt[field]);

                fieldDTElement = self.localDOM.createElement("dt");
                fieldLabelElement = self.localDOM.createElement("span");
                fieldLabelElement.innerHTML = field;
                fieldLabelElement.classList.add("fieldlabel");
                fieldLabelElement.classList.add(field);
                fieldLabelElement.classList.add(listItemView.__data__.igt[field]);
                fieldDTElement.appendChild(fieldLabelElement);
                fieldList.appendChild(fieldDTElement);

                fieldDDElement = self.localDOM.createElement("dd");
                fieldElement = self.localDOM.createElement("span");
                fieldElement.contentEditable = 'true';
                fieldElement.classList.add("fieldvalue");
                fieldElement.classList.add(field);
                fieldElement.classList.add(listItemView.__data__.igt[field]);
                component.fieldViews[field] = fieldElement;
                fieldDDElement.appendChild(fieldElement);
                fieldList.appendChild(fieldDDElement);

                var viewPath = "fieldViews." + field + ".value";
                var dataPath = "listItemView.__data__.igt." + field;
                var bindSet = {};
                bindSet[viewPath] = {
                  "<-": dataPath
                };
                var bindTwoWay = {};
                bindTwoWay[dataPath] = {
                  "<->": viewPath
                };
                Bindings.defineBindings(component, bindSet);
                Bindings.defineBindings(component, bindTwoWay);

              } catch (e) {
                console.warn(e);
              }
            }
          }

          Bindings.defineBindings(component, {
            "headwordView.value": {
              "<-": "listItemView.__data__.igt.headword"
            },
            "saveButtonView.innerHTML": {
              "<-": "'Save '+listItemView.__data__.igt.headword"
            },
            // "saveButtonView.classList.has('btn-danger')": {
            //   "<-": "listItemView.__data__.unsaved"
            // },
            "discussionView.value": {
              "<-": "listItemView.__data__.igt.discussion"
            },
            "contextsView.innerHTML": {
              // "<-": "' '+listItemView.__data__.utteranceContext.join(',')+listItemView.__data__.utteranceContext?listItemView.__data__.utteranceContext.length : '0'"
              "<-": "listItemView.__data__.utteranceContext.join(' ; ')"
            },
            "listItemView.title": {
              "<-": "'Example: '+listItemView.__data__.utteranceContext.join(' Example: ')"
            },
            "listItemView.hidden": {
              "<-": "listItemView.__data__.igt.confidence < self.localDOM.getElementById('lexiconConfidenceThreshold').value / 10"
            }
          });

          Bindings.defineBindings(component, {
            "listItemView.__data__.igt.headword": {
              "<->": "headwordView.value"
            },
            "listItemView.__data__.igt.discussion": {
              "<->": "discussionView.value"
            }
          });

          listItemView.appendChild(headword);
          listItemView.appendChild(discussion);
          listItemView.appendChild(fieldList);
          listItemView.appendChild(contexts);
          listItemView.appendChild(saveButton);
          listElement.appendChild(listItemView);

        });

      }
    },

    toJSON: {
      value: function() {
        return JSON.stringify(this.toObject(), null, 2);
      }
    },

    guessContextSensitiveGlosses: {
      value: function(datum) {

        if (!datum.morphemes) {
          console.warn("There was no morphemes line to guess the gloss from...");
          return datum;
        }
        var glossGroups = [];
        var matchingNodes = [];
        var morphemeToFind = "";
        var morphemeGroup = datum.morphemes.split(/ +/);
        var matchingfunction = function(node) {
          if (node.igt.morphemes === morphemeToFind) {
            // console.log(node);
            matchingNodes.push(node);
          }
        };
        for (var group in morphemeGroup) {
          var morphemes = morphemeGroup[group].split("-");
          var glosses = [];
          for (var m in morphemes) {
            if (!morphemes.hasOwnProperty(m)) {
              continue;
            }
            matchingNodes = [];
            morphemeToFind = morphemes[m];
            this.filter(matchingfunction);

            var gloss = "?"; // If there's no matching gloss, use question marks
            if (matchingNodes && matchingNodes.length > 0) {
              // Take the first gloss for this morpheme
              // console.log("Glosses which match: " + morphemes[m], matchingNodes);
              try {
                gloss = matchingNodes[0].igt.gloss;
              } catch (e) {
                // console.log(matchingNodes);
              }
            }
            glosses.push(gloss);
          }

          glossGroups.push(glosses.join("-"));
        }
        datum.glossAlternates = datum.glossAlternates ? datum.glossAlternates.concat(glossGroups) : glossGroups;
        datum.gloss = glossGroups.join(" ");
        // Replace the gloss line with the guessed glosses
        return datum;
      }
    },

    /**
     * Takes as a parameters an array of this.precedenceRelations which came from CouchDB precedence rule query.
     * Example Rule: {"key":{"x":"@","relation":"preceeds","y":"aqtu","context":"aqtu-nay-wa-n"},"value":2}
     */
    generatePrecedenceForceDirectedRulesJsonForD3: {
      value: function(dontConnectWordBoundaries) {
        /*
         * Cycle through the precedence rules, convert them into graph edges with the morpheme index in the morpheme array as the source/target values
         */
        var morphemeLinks = [];
        var morphemes = {};


        /*
         * Create the JSON required by D3
         */
        var precedenceGraph = {
          links: morphemeLinks,
          nodes: morphemes
        };
        this.precedenceGraph = precedenceGraph;

        return precedenceGraph;
      }
    }
  });

  /**
   * Constructs a lexicon given an input of precedenceRules or an orthography
   *  
   * @param {[type]} options [description]
   */
  var LexiconFactory = function(options) {
    // var lex = new Lexicon(null, Lexicon.prototype.igtEqual, Lexicon.prototype.igtCompare);
    var lex = new Lexicon();
    lex.precedenceRelations = new UniqueSet();
    lex.references = new UniqueSet();
    if (options.precedenceRelations && options.precedenceRelations.length > 0) {
      for (var i in options.precedenceRelations) {
        try {
          //Add source target and value to the link
          delete options.precedenceRelations[i].key.previous.utterance;
          delete options.precedenceRelations[i].key.subsequent.utterance;
          options.precedenceRelations[i].key.utteranceContext = options.precedenceRelations[i].key.context.utterance;
          options.precedenceRelations[i].key.datumid = options.precedenceRelations[i].id;

          // Put the previous and subsequent morphemes into the morpheme nodes
          // lex.add(options.precedenceRelations[i].key.context.utterance, new LexiconNode({
          //   igt: options.precedenceRelations[i].key.previous
          // }));
          lex.add(new LexiconNode({
            igt: options.precedenceRelations[i].key.previous,
            datumids: [options.precedenceRelations[i].key.context.id],
            utteranceContext: [options.precedenceRelations[i].key.context.utterance],
            url: options.url
          }));

          // lex.add(options.precedenceRelations[i].key.context.utterance, new LexiconNode({
          //   igt: options.precedenceRelations[i].key.previous
          // }));
          lex.add(new LexiconNode({
            igt: options.precedenceRelations[i].key.subsequent,
            datumids: [options.precedenceRelations[i].key.context.id],
            utteranceContext: [options.precedenceRelations[i].key.context.utterance],
            url: options.url
          }));
          lex.references.add(options.precedenceRelations[i].key.context.id);

          //To avoid loops
          if (options.precedenceRelations[i].key.subsequent.morphemes.indexOf("@") === -1) {
            lex.precedenceRelations.add(options.precedenceRelations[i].key);
          }

        } catch (e) {
          console.warn(e);
        }

      }
    }
    if (options.orthography || options.wordFrequencies) {
      if (options.nonContentWordsArray) {
        options.userSpecifiedNonContentWords = true;
        if (Object.prototype.toString.call(options.nonContentWordsArray) === '[object Array]' && options.nonContentWordsArray.length === 0) {
          options.userSpecifiedNonContentWords = false;
          // console.log("User sent an empty array of non content words, attempting to automatically detect them");
        }
        // else if (options.nonContentWordsArray.trim && !options.nonContentWordsArray.trim()) {
        //   options.userSpecifiedNonContentWords = false;
        // }
      }
      if (options.orthography && (!options.wordFrequencies || options.wordFrequencies.length === 0) && typeof Lexicon.bootstrapLexicon === "function") {
        Lexicon.bootstrapLexicon(options);
      }
      options.wordFrequencies = options.wordFrequencies || [];

      for (var wordIndex in options.wordFrequencies) {
        if (!options.wordFrequencies.hasOwnProperty(wordIndex)) {
          continue;
        }
        var word = options.wordFrequencies[wordIndex];
        if (typeof word === "string") {
          word = {
            orthography: word
          };
        }
        /* accept Datum as words */
        if (!word.igt && word.fields) {
          word.igt = word.fields;
        }
        if (!word.igt) {
          word.igt = {};
        }
        if (word.orthography && !word.igt.orthography) {
          word.igt.orthography = word.orthography;
          delete word.orthography;
        }
        word.count = word.count || 0;
        word.categories = word.categories || [];
        word.datumids = word.datumids || word.docids || [];
        if (options._id) {
          word.datumids.push(options._id);
        }
        if (options.url) {
          word.url = options.url;
        }
        if (lex.length > Lexicon.maxLexiconSize) {
          console.warn("Ignoring lexical entry (lexicon has reached max size " + Lexicon.maxLexiconSize + ") ", word);
          continue;
        }
        lex.add(new LexiconNode(word));
      }
    }

    for (var property in options) {
      if (options.hasOwnProperty(property)) {
        lex[property] = options[property];
      }
    }
    return lex;
  };

  Lexicon.LexiconNode = LexiconNode;
  Lexicon.LexiconFactory = LexiconFactory;
  Lexicon.maxLexiconSize = 1000;

  try {
    global.Lexicon = Lexicon;
  } catch (e) {
    console.log(e);
  }
  exports.Lexicon = Lexicon;


  // }(typeof exports === 'object' && exports || this));
})(typeof exports === 'undefined' ? this : exports);
