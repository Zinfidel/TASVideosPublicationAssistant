
var IA_SOLR = (function ($) {
    var ia_solr = {};

    ia_solr.baseURL = '/advancedsearch.php';

    ia_solr.getQuery = function(query, fields, rows, page, sortFields) {

        // Set some defaults
        fields = fields || ['identifier'];
        rows = rows || 50;
        page = page || 1;

        var params = { q: query, output: 'json', save: 'yes',
                       fl: fields,
                       rows: rows,
                       page: page
        };
        if (sortFields) {
            params.sort = sortFields;
        }

        return ia_solr.baseURL + '?' + $.param(params);
    };

    ia_solr.getUserUploadQuery = function(uploader, rows, page, sortFields) {
        var fields = ['identifier', 'avg_rating', 'collection', 'date',
                      'downloads', 'licenseurl', 'subject', 'title', 'description', 'language',
                      // $$$ these won't actually come back - 'updatedate', 'updater',
                      'publicdate'
                       ];
        return ia_solr.getQuery('uploader:' + uploader, fields, rows, page, sortFields);
    };

    return ia_solr;

}(jQuery));

var IA_UPLOADER = (function ($) {

    var ia_uploader = {};

    // $$$ update to production before deployment
    ia_uploader.apiEndpoint = '/upload/app/upload_api.php';
    ia_uploader.s3_base_url = 'https://s3.us.archive.org/';
    ia_uploader.s3_access_key = null;
    ia_uploader.s3_secret_key = null;
    ia_uploader.mode = 'upload'; //'upload' to new item or 'add' files to existing item
    ia_uploader.version = '';
    ia_uploader.is_admin = 0;
    ia_uploader.max_id_length = 0;

    ia_uploader.meta_index = {};
    ia_uploader.identifier = null;
    ia_uploader.suggested_identifier = null;
    ia_uploader.primary_collection = null;
    ia_uploader.files_array = [];
    ia_uploader.license_url = "";

    ia_uploader.xhr = new XMLHttpRequest();

    ia_uploader.current_file = 0;
    ia_uploader.total_bytes = 0.0;
    ia_uploader.total_sent = 0.0;
    ia_uploader.num_entries_queued = 0;
    ia_uploader.num_entries_processed = 0;
    ia_uploader.treetable_id_counter = 0;
    ia_uploader.largest_file = {size:0, index:0};
    ia_uploader.upload_start_time = null;
    ia_uploader.RETURN_KEYCODE = 13;
    ia_uploader.CREATIVE_COMMONS_LICENSE_VERSION = '4.0';

    /* Old implementation
    ia_uploader.Uploader = function(targetElement) {
        this._jTargetElement = $(targetElement);

        this.init = function() {
            // Template elements are cloned to create new elements
            this._itemTemplate = $('.item.template').clone().removeClass('template');
            this._inProgressTemplate = $('.inProgressRow.template').clone().removeClass('template');
        };

        // ---- Item rows ----
        this.setItemValues = function(jItemElement, params) {
            // $$$ # files not yet implemented
            //console.log(params);
            jItemElement.find('.itemName a').attr('href', '/details/' + params.identifier).html(params.title);
            jItemElement.find('.license').html(params.licenseurl);
            jItemElement.find('.language').html(this.formatLanguage(params.language));
            jItemElement.find('.ratings').html(this.formatRating(params.avg_rating));
            jItemElement.find('.views').html(params.downloads);
            jItemElement.find('.description').html(params.description);
            jItemElement.find('.keywords').html(this.formatSubject(params.subject));

            // $$$ update time not yet implemented
            jItemElement.find('.updateTime').html(this.formatDate(params.publicdate)); // $$$ get updatedate to come back from solr
            return jItemElement;
        };

        this.newItem = function(params) {
            return this.setItemValues(this._itemTemplate.clone(), params);
        };

        this.addItem = function(params) {
            this.newItem(params).appendTo(this._jTargetElement.find('.uploadsTable')).show();
        };


        // ---- Uploads table ----
        this.populateUploadsTable = function(query) {

            var self = this;
            $.ajax(
                // $$$ maxing out at 500 items - pageinate
                { url: IA_SOLR.getUserUploadQuery(query, 500, 1, ['publicdate desc']), type: 'jsonp',
                  success: function(data)
                    {
                        if (data.responseHeader.status == 0) {
                            for (var i = 0; i < data.response.docs.length; i++) {
                                self.addItem(data.response.docs[i]);
                            }
                        } else {
                            // XXX show error
                        }
                    }
                }
            );
        };


        // ---- Data formatting ----
        this.formatRating = function(rating) {
            switch (rating) {
                case 1:
                    return '*';
                case 2:
                    return '**';
                case 3:
                    return '***';
                case 4:
                    return '****';
                case 5:
                    return '*****';
            }

            return '';
        };

        this.formatLanguage = function(language) {
            if (!language) {
                return '';
            }

            return "In " + language.join(', ');
        };

        this.formatSubject = function(subject) {
            if (!subject) {
                return '';
            }

            return subject.join(', ');
        };

        this.formatDate = function(dateStr) {
            return prettyDate(dateStr) || dateStr;
        };
    };
    */

    ia_uploader.capitalize = function(word) {
        return word.substr(0,1).toUpperCase() + word.substring(1);
    };

    /* Given a filename convert it to an item title. Try to break at word boundaries and otherwise clean up. */
    ia_uploader.filenameToTitle = function(filename) {
        // $$$ look for common camera filenames, e.g. IMG_00122.jpg
        //     and return e.g. "Mang's Photo 122" or "Mang's Movie 1281"

        var extension = new RegExp('\\.[a-zA-Z][a-zA-Z0-9]*$');
        filename = filename.replace(extension, '');

        // Return single lowercase words (e.g. file names) unparsed -- per Cleanup Week request

        if ((filename.split(" ").length == 1) && (/^[a-z]/.test(filename))) {
            return filename;
        }

        // Things that precede or start a word (delimiters)
        // - whitespace (including beginning of line)
        // - capital(s)
        // - dash or underscore
        // - numeral(s)
        //
        // The basic strategy is to look for obvious breaks between words then see if any
        // of those matches should be split down further

        var wordBreak = new RegExp('[^ _-]+', 'g');
        var wordStart = new RegExp('([A-Z]+|[0-9][0-9\\.]*)', 'g');
        var containsAlphaNumeric = new RegExp('\\w');

        var words = [];

        var compoundMatch;
        while (compoundMatch = wordBreak.exec(filename)) {
            var compoundWord = compoundMatch[0];

            /* Break up compound word */
            var breakMatch;
            var startIndex = 0;
            while (breakMatch = wordStart.exec(compoundWord)) {
                if (breakMatch.index == 0) {
                    continue;
                }

                // Check we have any "normal" characters, if not combine with next match
                if (containsAlphaNumeric.test(breakMatch[0])) {
                    // Capitalize and add to list
                    words.push(compoundWord.substr(startIndex, 1).toUpperCase() + compoundWord.substring(startIndex + 1, breakMatch.index));
                    startIndex = breakMatch.index;
                }
            }

            /* Last or only word */
            words.push(compoundWord.substr(startIndex, 1).toUpperCase() + compoundWord.substring(startIndex + 1, compoundWord.length));
        }

        return words.join(' ');
    };

    /* Now handled on server side
    ia_uploader.titleToIdentifier = function(title) {
        var wordPattern = new RegExp('[A-Za-z0-9]+','g');
        var words = [];
        while (wordMatch = wordPattern.exec(title)) {
            words.push(ia_uploader.capitalize(wordMatch[0]));
        }
        return words.join('');
    }
    */

    ia_uploader.getItemStatus = function(identifier, callback) {
        // XXX proper url encoding
        var statusUrl = '/catalog_status.php?identifier=' + identifier;
        //var statusUrl = "status.xml"; // testing
        var theCallback = callback; // closure
        $.ajax({
            type: "GET",
            url: statusUrl,
            dataType: "xml",
            success: function(xml) {
                // console.log(xml);
                var queued = $(xml).find('wait_admin0').text(); // Green
                var running = $(xml).find('wait_admin1').text(); // Blue
                var stuck = $(xml).find('wait_admin2').text(); // Red
                var skipped = $(xml).find('wait_admin9').text(); // Brown
                // console.log(queued + ' - ' + running + ' - ' + stuck + ' - ' + skipped);
                theCallback({identifier: identifier,
                             queued: parseInt(queued) || 0, running: parseInt(running) || 0,
                             stuck: parseInt(stuck) || 0, skipped: parseInt(skipped) || 0});
            }
            // $$$ failure handling
        });
    };

    ia_uploader.identifierAvailable = function(identifier, findUnique, successCallback, errorCallback) {
        $.ajax({
            type: "POST",
            url: this.apiEndpoint,
            data: {'name':'identifierAvailable', 'identifier':identifier, 'findUnique': findUnique },
            //data: {'name':'returnStatus', 'status': 504 }, // For testing
            dataType: "jsonp",
            success: successCallback,
            error: errorCallback
        });
    }


    ia_uploader.countUpload = function(fileCount, totalBytes) {
        $.ajax({
            type: "POST",
            url: this.apiEndpoint,
            data: { name: 'countUpload', fileCount: fileCount, totalBytes: totalBytes },
            dataType: "jsonp"
        });

        var upload_end_time = new Date().getTime();
        var upload_time = Math.round((upload_end_time-this.upload_start_time)/1000.0);

        var values = {
            'uploader': 1,
            'success': 1,
            'id': this.identifier,
            'bytes': totalBytes,
            'files': fileCount,
            'seconds': upload_time,
            'referrer': 'https://archive.org/upload'
        };
        if (typeof(archive_analytics) != 'undefined') {
            archive_analytics.send_ping(values);
        }
    }


    ia_uploader.countError = function(httpStatus) {
        $.ajax({
            type: "POST",
            url: this.apiEndpoint,
            data: { name: 'countError', httpStatus: httpStatus },
            dataType: "jsonp"
        });
    }

    // Replace form elements with their values
    ia_uploader.replaceFormElementsWithValue = function(elements) {
        $.each(elements, function(index, elem) {
            var replacement;

            if ($(elem).is('input')) {
                if ($(elem).hasClass('ui-autocomplete-input') || $(elem).is('[type=submit]')) {
                     return true;
                }

                if ($(elem).is('input[type=checkbox]')) {
                    $(elem).attr('disabled', 'disabled');
                } else {
                    replacement = $('<span>' + $(elem).val() + '</span>');
                    $(elem).after(replacement).hide();
                }

            } else if ($(elem).is('select')) {
                if ($(elem).data('combobox')) {
                    $(elem).combobox('destroy');
                }
                replacement = $('<span>' + $(elem).find('option:selected').text() + '</span>');
                $(elem).after(replacement).hide();
            } else if ($(elem).is('textarea')) {
                if ($(elem).data('wysiwyg')) {
                    $(elem).wysiwyg('save').wysiwyg('destroy');
                }
                replacement = $('<span>' + $(elem).val() + '</span>');
                $(elem).after(replacement).hide();
            } else {
                if (console && console.log) {
                    console.log("Don't know how to replace element with value");
                    console.log(elem);
                }
            }

            return true;
        });
    }

    // Return bytes formatted as string.  Include a single decimal if it will be > 1% of the value.
    // e.g. 1.2KB or 11KB
    ia_uploader.formatFileSize = function(bytes) {
        var val = bytes;
        var units = ['KB', 'MB', 'GB', 'TB', 'PB'];

        if (bytes < 1024) {
            return $.sprintf("%d bytes", val);
        }

        for (var i = 0; i < units.length; i++) {
            val /= 1024;
            if (val < 1024) {
                if (val < 10) {
                    return $.sprintf("%.1f %s", val, units[i]);
                } else {
                    return $.sprintf("%d %s", val, units[i]);
                }
            }
        }

        // Reached end - BIG DATA
        return $.sprintf("%d %s", val, units[units.length - 1]);
    }

    // Return an IA mediatype guessed from mimeType
    // $$$ should also pass in the file name, e.g. foo_images.zip should be "texts"
    ia_uploader.mediaTypeForMimeType = function(file) {
        var mimeType = file.type;

        // Ref http://en.wikipedia.org/wiki/Internet_media_type

        // Specific mime types - exact match is preferred over regexs below
        switch (mimeType) {
            case 'application/pdf':
            case 'application/epub+zip':
            case 'application/postscript':
            case 'application/msword':
            case 'application/vnd.oasis.opendocument.text':
            case 'application/vnd.oasis.opendocument.presentation':
            case 'application/vnd.ms-powerpoint':
            case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                return 'texts';

            case 'application/ogg':
                return 'video';

            case '':
                if (file.name.match(/\.cdr$/)) {
                    return 'video';
                } else if (file.name.match(/\.mov$/)) {
                    return 'video';
                }
        }

        if (mimeType.match(/^text/)) {
            return 'texts';
        }

        if (mimeType.match(/^audio/)) {
            return 'audio';
        }

        if (mimeType.match(/^video/)) {
            return 'video';
        }

        if (mimeType.match(/^image/)) {
            return 'images';
        }

        // Generally _images.zip and/or _images.tar files contains images for a book
        // See here: https://webarchive.jira.com/browse/WEBDEV-2580
        if (file.name.match(/(_images.zip|_images.tar)$/)) {
            return 'texts';
        }

        return ''; // unknown mediatype

    }

    // For a set of mime types (from multiple files) guess the best mediatype
    // for the item as a whole
    ia_uploader.mediaTypeForMimeTypes = function(largest_file) {
        var count = {};
        // Choose mediatype based on largest file
        /*
        $.each(this.files_array, function(index, file) {
            var mediaType = ia_uploader.mediaTypeForMimeType(file);
            if (!count.hasOwnProperty(mediaType)) {
                count[mediaType] = 1;
            } else {
                count[mediaType]++;
            }
        });
        */
        var mediaType = ia_uploader.mediaTypeForMimeType(largest_file);
        count[mediaType] = 1;

        if (count['video']) {
            return 'movies';
        }

        if (count['audio']) {
            return 'audio'; // if there's audio and text, text likely goes with the audio
        }

        if (count['texts']) {
            return 'texts';
        }

        if (count['images']) {
            return 'image';
        }

        return ''; // unfortunately there's no "data" or "mixed" or "unknown"

    }

    ia_uploader.defaultCollectionForMediaType = function(mediaType, defaultCollections) {
        if (defaultCollections.hasOwnProperty(mediaType)) {
            var defaultCollection = defaultCollections[mediaType];
            var text = mediaType + ':' + defaultCollection;
            return text;
        } else {
            var defaultCollection = defaultCollections['data'];
            var text = 'texts:' + defaultCollection;
            return text;
        }
    }

    ia_uploader.addMetaField = function(div) {
        var keynum = ($('.additional_meta_key').length +1).toString();
        var str = $.sprintf('<div class="additional_meta"><input type="text" name="additional_meta_key_%s" class="additional_meta_key replace required metakey_regex metakey_limit" placeholder="key"/>: <input type="text" name="additional_meta_value_%s" class="additional_meta_value replace required" placeholder="value" /> <a href="javascript:void(0);" onclick="$(this).parent().remove();" class="additional_meta_remove_link">(remove)</a></div>', keynum, keynum);
        div.append(str);
    }

    ia_uploader.getS3MetaHeader = function(key) {
        if (key in this.meta_index) {
            this.meta_index[key]++;
        } else {
            this.meta_index[key] = 1;
        }

        var key_index = this.meta_index[key].toString();
        if (1 == key_index.length) {
            key_index = "0" + key_index;
        }

        return "x-archive-meta"+key_index+"-"+key;
    }


    // check_id()
    //____________________________________________________________________________________
    ia_uploader.check_id = function(identifier) {
        var self = this;

        //remove green check
        self.validate_element($("#item_id")[0], '');

        this.identifierAvailable(identifier, true,
            // Success callback
            function(response) {
                if (response.success) {
                     // Hide other than success messages
                    //$('.createIdentifierMessage').not('.createIdentifierFound').hide();

                    // Show success message
                    //$('.createItemIdentifier').text(response.identifier);
                    //$('.createIdentifierFound').show();

                    // Allow uploading
                    //$('.createUploadButton').val('Upload').removeAttr('disabled');
                    self.identifier = response.identifier;
                    $("#item_id").text(response.identifier).show();
                    $("#page_url").show();
                    $("#create_id_checking").hide();
                    $('#upload_button').text('Upload and Create Your Item').removeClass('btn-default').addClass('btn-primary').attr('disabled', false);
                    self.validate_element($("#item_id")[0], response.identifier);
                } else {
                    // Show error message
                    //$('.createIdentifierMessage').not('.createIdentifierError').hide();
                    //$('.createIdentifierError').show();
                    //$('.createUploadButton').val('Upload');
                    console.log('identifier lookup returned ' + response.success);
                }
            },

            // Error callback
            function(jqXHR, textStatus, errorThrown) {
                // Show error message
                //$('.createIdentifierMessage').not('.createIdentifierSystemError').hide();
                //$('.createIdentifierSystemError').show();
                //$('.createUploadButton').val('Upload');
                console.log('error in identifier lookup');
            }

        );
    }


    // choose_files_finish()
    //____________________________________________________________________________________
    ia_uploader.choose_files_finish = function() {
        $("#file_drop").hide();

        $("#upload_button").show();
        if ('add' === this.mode) {
            $("#upload_button").text("Add files to existing item").removeClass('btn-default').addClass('btn-primary').attr('disabled', false);
        } else {
            var title = $("#page_title").text();
            if (('' === title) || ('Click to edit' === title) || ($('#page_title').attr('title') === title)) {
                var largest_file = this.files_array[this.largest_file.index];
                title = IA_UPLOADER.filenameToTitle(largest_file.name);
                $("#page_title").text(title);
            } else {
                //console.log('title ', title);
            }

            if (this.suggested_identifier) {
                var desiredIdentifier = this.suggested_identifier;
            } else {
                var desiredIdentifier = title;
            }

            this.check_id(desiredIdentifier);
        }

        this.auto_select_collection();

        $("#file_info").show();
        $("#preset_link").show();

        // Prevent the window from being accidentally closed during upload.
        // Since this page contains an iframe, firefox will show the warning twice:
        //  https://bugzilla.mozilla.org/show_bug.cgi?id=636374
        window.onbeforeunload = function(e) {
            return 'Closing this window will cancel the upload.';
        };

        IA_UPLOADER.validate(false); //set green checkmarks
    }


    // add_files()
    //____________________________________________________________________________________
    ia_uploader.add_files = function(file_list) {
        for (var i=0; i < file_list.length; i++) {
            var file_name = '/'+file_list[i].name;
            for (var j=0; j<this.files_array.length; j++) {
                var existing_file_name = this.files_array[j].s3path;
                if (file_name === existing_file_name) {
                    this.overlay_alert('You can not add multiple files with the same name.', 'A file with the name "'+file_name+'" already exists in the upload list. Please try adding files again.');
                    return;
                }
            }
        }

        for (var file_num = 0; file_num < file_list.length; file_num++) {
            this.num_entries_queued++;
            var f = file_list[file_num];

            var file_entry  = null;
            var parent_node = null;
            var add_mode    = true;
            this.process_file(f, file_entry, parent_node, add_mode);
        }

    }


    // add_items()
    //____________________________________________________________________________________
    ia_uploader.add_items = function(items, files) {
        for (var i=0; i < items.length; i++) {
            var entry = items[i].webkitGetAsEntry();
            if (null === entry) {
                 //Chrome on Windows somtimes adds an item to the DataTransferItemList of
                 //kind=string and type:text-uri-list. We should skip it.
                continue;
            }
            var file_name = entry.fullPath;
            //console.log('checking', file_name);
            for (var j=0; j<this.files_array.length; j++) {
                var existing_file_name = this.files_array[j].s3path;
                if (file_name === existing_file_name) {
                    this.overlay_alert('You can not add multiple files with the same name.', 'A file with the name "'+file_name+'" already exists in the upload list. Please try adding files again.');
                    return;
                } else if (existing_file_name.lastIndexOf(file_name, 0) === 0) {
                    this.overlay_alert('You can not add multiple directories with the same name.', 'Please try adding files again.');
                    return;
                }
            }
        }

        var self = this;
        var add_mode = true;
        this.choose_items(items, add_mode);
    }


    // make_dir_row()
    //____________________________________________________________________________________
    ia_uploader.make_dir_row = function(dir_path, parent_node) {
        var id;

        // There is a treetable bug when using dotted data-tt-ids, such as '1.200'
        // data-tt-ids are now numeric strings, generated by incrementing a global counter
        /*
        if (null !== parent_node) {
            id = $.sprintf('%s.%d', parent_node.id, dir_num);
        } else {
            id = dir_num.toString();
        }
        */
        id = (this.treetable_id_counter++).toString();

        var name = dir_path.split('/').slice(-1)[0];

        var row = $('<tr>').attr('data-tt-id', id);
        if (null !== parent_node) {
            row.attr('data-tt-parent', parent_node.id);
        }

        var size = '--';

        row.append($('<td>').append($('<span>').addClass('folder').text(name)));
        row.append($('<td>').text(size));
        row.append($('<td>').append($('<a href="#" onclick=\'IA_UPLOADER.remove_item("'+id+'"); return false;\'><img src="img/removered.png"/></a>')));
        return row;
    }


    // add_dir_row()
    //____________________________________________________________________________________
    ia_uploader.add_dir_row = function(dir_path, parent_node) {
        var dir = this.make_dir_row(dir_path, parent_node);
        //console.log('dir num', dir_num);
        var id = dir.attr('data-tt-id');
        if (null !== parent_node) {
            dir.attr('data-tt-parent-id', parent_node.id);
        }
        $('#file_table').treetable('loadBranch', parent_node, dir);

        var dir_node = $('#file_table').treetable('node', id);

        dir_node.path = dir_path; //use expando to hold path in TreeTable.Node object

        return dir_node;
    }


    // make_file_row()
    //____________________________________________________________________________________
    ia_uploader.make_file_row = function(file, parent_node, id) {

        var name;
        if (file.s3path !== undefined) {
            name = file.s3path;
        } else {
            name = file.name;
        }

        name = name.split('/').slice(-1)[0];

        var row = $('<tr>').attr('data-tt-id', id);
        if (null !== parent_node) {
            row.attr('data-tt-parent-id', parent_node.id);
        }

        var size = this.formatFileSize(file.size);

        row.append($('<td>').append($('<span>').addClass('file').text(name)));
        row.append($('<td>').text(size));
        row.append($('<td>').append($('<a href="#" onclick=\'IA_UPLOADER.remove_item("'+id+'"); return false;\'><img src="img/removered.png"/></a>')));
        return row;
    }


    // process_file()
    //  - add_mode should be false the first time files are chosen, and true when
    //    additional files are added to the file list.
    //____________________________________________________________________________________
    ia_uploader.process_file = function(f, entry, parent_node, add_mode) {
        //use expando property to hold full path
        if (null !== entry) {
            f.s3path = entry.fullPath;
        } else {
            f.s3path = '/'+f.name;
        }

        var id;
        // There is a treetable bug when using dotted data-tt-ids, such as '1.200'
        // data-tt-ids are now numeric strings, generated by incrementing a global counter
        /*
        if (null !== parent_node) {
            id = $.sprintf('%s.%d', parent_node.id, file_num);
        } else {
            id = file_num.toString();
        }
        */
        id = (this.treetable_id_counter++).toString();

        //use expando to hold treetable id
        f.id = id;

        this.files_array.push(f);

        var row = this.make_file_row(f, parent_node, id);

        $('#file_table').treetable('loadBranch', parent_node, row);

        var file_node = $('#file_table').treetable('node', id);
        file_node.path = f.s3path; //use expando to hold path in TreeTable.Node object

        if (f.size > this.largest_file.size) {
            this.largest_file.size = f.size;
            this.largest_file.index =  this.files_array.length-1;
        }

        this.num_entries_processed++;
        //console.log('queued=', this.num_entries_queued, ' processed=', this.num_entries_processed);

        if (this.num_entries_queued === this.num_entries_processed) {
            $('#overlay_alert').remove();
            $('#overlay').remove();
            if (false === add_mode) {
                //console.log('finished processing initial file list:');
                //console.log(this.files_array);
                this.choose_files_finish();
            }
        }

    }


    // get_file_from_fileentry()
    //____________________________________________________________________________________
    ia_uploader.get_file_from_fileentry = function(entry, parent_node, add_mode) {
        var self = this;
        this.num_entries_queued++;
        entry.file(function(f) {
            self.process_file(f, entry, parent_node, add_mode);
        });
    }


    // get_files_from_direntry()
    //____________________________________________________________________________________
    ia_uploader.get_files_from_direntry = function(entry, parent_node, add_mode) {
        var reader = entry.createReader();
        var self = this;

        var dir_path = entry.fullPath;
        var dir_node = this.add_dir_row(dir_path, parent_node);

        reader.readEntries(function(results) {
            for (var i = 0; i < results.length; i++) {
                var entry = results[i];
                if (entry.isDirectory) {
                    self.get_files_from_direntry(entry, dir_node, add_mode);
                } else if (entry.isFile) {
                    self.get_file_from_fileentry(entry, dir_node, add_mode);
                }
            }
        });
    }


    // choose_items()
    //____________________________________________________________________________________
    ia_uploader.choose_items = function(items, add_mode) {
        this.overlay_loading();

        for (var i = 0; i < items.length; i++) {
            var entry = items[i].webkitGetAsEntry();
            if (null === entry) {
                 //Chrome on Windows adds an item to the DataTransferItemList of
                 //kind=string and type:text-uri-list. We should skip it.
                continue;
            }
            var parent_node = null;
            if (entry.isDirectory) {
                this.get_files_from_direntry(entry, parent_node, add_mode);
            } else if (entry.isFile) {
                this.get_file_from_fileentry(entry, parent_node, add_mode);
            }
            //console.log('parsing top-level entry:')
            //console.log(entry);
        }
    }

    // choose_files()
    //____________________________________________________________________________________
    ia_uploader.choose_files = function(file_list) {
        this.num_entries_queued = file_list.length;
        for (var file_num = 0; file_num < file_list.length; file_num++) {
            var f = file_list[file_num];
            var file_entry  = null;
            var parent_node = null;
            var add_mode    = false;
            this.process_file(f, file_entry, parent_node, add_mode);
        }

    }


    // remove_item()
    //____________________________________________________________________________________
    ia_uploader.remove_item = function(id) {

        var tt_node = $('#file_table').treetable('node', id);
        var path_to_rm = tt_node.path; //expando

        //console.log('removing', id, path_to_rm);

        for(var i=this.files_array.length-1; i>=0; i--) {
            if(id === this.files_array[i].id) {
                //console.log('  removing index', this.files_array[i]);
                this.files_array.splice(i, 1);
            } else if (this.files_array[i].s3path.lastIndexOf(path_to_rm+'/', 0) === 0) {
                //a directory being removed
                //console.log('  removing from dir', this.files_array[i]);
                this.files_array.splice(i, 1);
            }
        }

        $('#file_table').treetable('removeNode', id);
    }


    // auto_select_collection()
    //____________________________________________________________________________________
    ia_uploader.auto_select_collection = function() {
        var jSelect = $('[name=mediatypecollection]');
        var isLMA = jSelect.val().startsWith('etree:');
        var element = jSelect[0];
        // defaultCollections is always attached to DOM
        var defaultCollections = JSON.parse(element.getAttribute('data-default-collections'));

        // Choose collection based on largest file
        var largest_file = this.files_array[this.largest_file.index];
        // Try to autoselect the mediatype/collection
        // $$$ probably instead we should send the filename to the
        // petabox and check against the suffixes in Edit.inc
        // Also see share.php function setupMediatypeCollection
        var fileType = this.mediaTypeForMimeTypes(largest_file);
        var autoCollection = this.defaultCollectionForMediaType(fileType, defaultCollections);
        var splitVal = autoCollection.split(/:/g);
        var autoChosenType = splitVal[0];
        var collectionPlaceholderText = 'Community ' + autoChosenType;


        var isSelector = $(element).is('select');
        var isInput = $(element).is('input');


        if (isInput) {
            if (this.primary_collection) {
                // display & capture identifier in the autcollection field
                $(element).attr('data-chosen-value', autoChosenType + ':' + this.primary_collection);
                $(element).attr('data-chosen-label', this.primary_collection);
                collectionPlaceholderText = this.primary_collection;
            } else {
                $(element).attr('data-chosen-value', autoCollection);
                $(element).attr('data-chosen-label', collectionPlaceholderText);
            }
            $(element).val(collectionPlaceholderText);
            $(element).hide();
        }

        if (!isLMA && isSelector) {
           if (this.primary_collection !== null) {
                var selector = 'option[value$=":' + this.primary_collection + '"]';
            } else {
                var selector = 'option[value="' + autoCollection + '"]';
            }
            var options = jSelect.find(selector);

            if (options.length > 0) {
                // Option exists
                jSelect.val(options[0].value);
            } else {
                var placeholderSelector = 'option[value=""]';
                var placeholderOption = jSelect.find(placeholderSelector);
                jSelect.val(placeholderOption[0].value);
            }
            collectionPlaceholderText = jSelect.find("option:selected").text();
        }

        $('#collection').text(collectionPlaceholderText).removeClass('placeholder');
    }


    // set_license_text()
    //____________________________________________________________________________________
    ia_uploader.set_license_text = function() {
        //set this.license_url, and return the text name of the license for display
        var license_val = $('input[name=license_radio]:checked').val();
        var text = "No license selected";
        this.license_url = "";
        if ("CC0" === license_val) {
            text = "CC0";
            this.license_url = "http://creativecommons.org/publicdomain/zero/1.0/";
        } else if ("PD" === license_val) {
            text = "Public Domain";
            this.license_url = "http://creativecommons.org/publicdomain/mark/1.0/";
        } else if ("CC" === license_val) {
            var remix      = $('#cc_remix').is(':checked')
            var noncom     = $('#cc_noncom').is(':checked')
            var sharealike = $('#cc_sharealike').is(':checked')

            if (remix) {
                if (noncom && sharealike) {
                    text = "Creative Commons Attribution-NonCommercial-ShareAlike";
                    this.license_url = 'https://creativecommons.org/licenses/by-nc-sa/' + this.CREATIVE_COMMONS_LICENSE_VERSION + '/';
                } else if (noncom) {
                    text = "Creative Commons Attribution-NonCommercial";
                    this.license_url = 'https://creativecommons.org/licenses/by-nc/' + this.CREATIVE_COMMONS_LICENSE_VERSION + '/';
                } else if (sharealike) {
                    text = "Creative Commons Attribution-ShareAlike";
                    this.license_url = 'https://creativecommons.org/licenses/by-sa/' + this.CREATIVE_COMMONS_LICENSE_VERSION + '/';
                } else {
                    text = "Creative Commons Attribution";
                    this.license_url = 'https://creativecommons.org/licenses/by/' + this.CREATIVE_COMMONS_LICENSE_VERSION + '/';
                }
            } else if (noncom) {
                text = "Creative Commons Attribution-NonCommercial-NoDerivs";
                this.license_url = 'https://creativecommons.org/licenses/by-nc-nd/' + this.CREATIVE_COMMONS_LICENSE_VERSION + '/';
            } else {
                text = "Creative Commons Attribution-NoDerivs";
                this.license_url = 'https://creativecommons.org/licenses/by-nd/' + this.CREATIVE_COMMONS_LICENSE_VERSION + '/';
            }
        }
        return text;
    }


    // set_date()
    //____________________________________________________________________________________
    ia_uploader.set_date = function() {
        var date_text = $('#date_text').attr('title');
        var got_date = false;
        var year = $('#date_year').val();
        if ("" !== year) {
            got_date = true;
            date_text = year;
            var month = $('#date_month').val();
            if ("" !== month) {
                date_text += '-' + month;
                var day = $('#date_day').val();
                if ("" !== day) {
                    date_text += '-' + day;
                }
            }
        }
        $('#date_text').text(date_text);
        if (got_date) {
            $('#date_text').removeClass('placeholder');
        } else {
            $('#date_text').addClass('placeholder');
        }
        $('#date_text').show();
        $('#date_picker').hide();

        IA_UPLOADER.validate_date();
    }

    // collections_autocomplete
    ia_uploader.collections_autocomplete = function(selector) {
        var $collectionsInput = $(selector);
        var $spinnerContainer = $collectionsInput.siblings('.js-spinner-placeholder');

        var makeDefaultList = function makeDefaultCollectionsList() {
            var listToReturn = [];
            var defaultCollections = JSON.parse($("[name='mediatypecollection']").attr('data-default-collections'));
            var mediatypes = Object.keys(defaultCollections);
            mediatypes.forEach(function makeInputValue(mediatype) {
                var collectionId = defaultCollections[mediatype];
                var value = [mediatype, collectionId].join(':');
                var label = 'Community ' + mediatype;
                listToReturn.push({ label: label, value: value });
            })
            return listToReturn;
        };

        $collectionsInput.autocomplete({
            appendTo: $('.js-uploader-autocomplete-results'),
            minLength: 1,
            delay: 600,
            source: function collectionsAutocompleteCB (request, response) {
              var term = request.term;
              if (term.length < 1) {
                  return response([]);
              }

              var encodedTerm = encodeURIComponent(term);
              var url = '/services/collections/?filter_by=user_can_add_to&ui_context=upload_form&term=' + encodedTerm;

              // add spinner
              $spinnerContainer.html('<img src="/images/loading.gif">');
              $.ajax({
                method: 'GET',
                url: url
              })
              .success(function autcompleteFetch200(res) {
                var availableCollections = res.available_collections || {};
                var collections = Object.keys(availableCollections);
                // remove spinner before serving response
                $spinnerContainer.html('');

                if (!collections.length) {
                    var mainPlaceholder = {
                        label: 'Nothing found. Try these: ',
                        title: '',
                        value: ''
                    };
                    var defaultCollections = makeDefaultList();
                    defaultCollections.unshift(mainPlaceholder);
                    return response(defaultCollections);
                }

                var results = collections.map(function mapResults(identifier) {
                    var privs = $collectionsInput.attr('data-priv');
                    var value = identifier;
                    var title = availableCollections[identifier];
                    var label =  privs === 'slash' ? title + ' (' + value + ')' : title;
                    return { value: value, label: label, title: title };
                });
                response(results);
              })
              .error(function autocompleteFetchFail(res) {
                var errorPlaceholder = {
                    label: 'Something\'s amiss.  Please try again, or select from these: ',
                    value: '',
                    title: ''
                };
                var defaultCollections = makeDefaultList();
                defaultCollections.unshift(errorPlaceholder);
                // remove spinner before serving response
                $spinnerContainer.html('');
                return response(defaultCollections);
              })
            },
            focus: function autocomplete_focus() { return false }, // prevent value inserted on focus
            select: function autocomplete_select(event, ui) {
                var collectionId = ui.item.value;
                var label = ui.item.label;
                var title = ui.item.title;
                $("input[name='mediatypecollection']").attr('data-chosen-value', collectionId);
                $("input[name='mediatypecollection']").attr('data-chosen-label', title);
                this.value = title;
                $('#collection').val(title);
                return false;
            },
            change: function autocomplete_change(event, ui) {
                if (!ui.item) {
                    var label = $("input[name='mediatypecollection']").attr('data-chosen-label');
                    $("input[name='mediatypecollection']").val(label);
                }
            }
          })
    }

    // edit_value()
    //____________________________________________________________________________________
    ia_uploader.edit_value = function(parent_row) {
        var row_id = parent_row.attr('id');

        if ('collection_row' !== row_id) {
            // collection row has a helper label for new autocomplete input
            // make sure it hides when row isn't selected
            $('.js-collection-input-label').hide();
        }

        if ('description_row' === row_id) {
            $('#description').hide();
            $('#description_editor_div').show();
            $('#description_editor').wysiwyg('focus');
        } else if ('date_row' === row_id) {
            $('#date_text').hide();
            $('#date_picker').show();
            $('#date_year').focus();
        } else if ('collection_row' === row_id) {
            var $collectionDropdown = $('[name=mediatypecollection]');
            if ($collectionDropdown.is('input')) {
                $('[name=mediatypecollection]').val('');
                ia_uploader.collections_autocomplete('[name=mediatypecollection]');
                $('[name=mediatypecollection]').focus();
                $('.js-collection-input-label').show();
            }
            $('[name=mediatypecollection]').show();
            $('#collection').hide();
        } else if ('test_item_row' === row_id) {
            $('#test_item_select').show();
            $('#test_item').hide();
            this.validate_element($('#test_item')[0], true); //actual value doesn't matter
        } else if ('language_row' === row_id) {
            $('#language').hide();
            $('#language_select').show();
        } else if ('license_picker_row' === row_id) {
            $('#license_text').addClass('placeholder');
            $('#license_picker').show();
        } else if ('more_options_row' === row_id) {
            //nothing to do
        } else {
            var value_span = parent_row.find('.edit_text');
            if (value_span.hasClass('placeholder')) {
                var old_value = '';
            } else {
                var old_value = value_span.text();
            }
            var input_element = $('<input type="text"></input>').addClass('input_field').attr('placeholder', value_span.attr('title')).val(old_value);
            var self = this;
            input_element.keyup(function(event){
                if(event.keyCode == self.RETURN_KEYCODE){
                    self.save_value(parent_row); //typing return in a text box calls save_value()
                }
            });
            value_span.after(input_element);
            value_span.hide();
            input_element.focus();
        }
    }


    // save_value()
    //____________________________________________________________________________________
    ia_uploader.save_value = function(selected_rows) {
        //there should only be one row selected at a time, but handle more
        var self = this;
        selected_rows.each(function(i, e) {
            //console.log('saving ', e);
            var row = $(e);
            var row_id = row.attr('id');
            if ('page_url_row' === row_id) {
                var input_element = row.find('.input_field');
                var new_value = input_element.val();
                input_element.remove();
                if (new_value !== self.identifier) {
                    $("#create_id_checking").show();
                    $("#page_url").hide();
                    $('#upload_button').attr('disabled', true).text('Checking identifier...').removeClass('btn-primary').addClass('btn-default');
                    $('#item_id').text('').show(); //real value filled in by check_id callback
                    self.check_id(new_value);
                } else {
                    var value_span = row.find('.edit_text');
                    value_span.show();
                }
            } else if ('description_row' === row_id) {
                //The wysiwyg editor leaves empty span elements if the user deletes all content.
                //Validate against the text content, not the HTML. Also, if the text is blank,
                //reset the value to the default 'Click to edit', otherwise users will have
                //a hard time enabling the editor.
                var div = document.createElement("div");
                var value = $('#description_editor').wysiwyg('getContent');
                div.innerHTML = value;
                var text = $(div).text();
                if ('' == text) {
                    value = $('#description').attr('title');
                    $('#description').addClass('placeholder');
                } else {
                    $('#description').removeClass('placeholder');
                }
                self.validate_element($('#description')[0], text);
                $('#description').html(value).show();
                $('#description_editor_div').hide();
            } else if ('date_row' === row_id) {
                self.set_date();
            } else if ('collection_row' === row_id) {
                var collectionEl = $('[name=mediatypecollection]')[0];
                var isSelect = $(collectionEl).is('select');
                var isInput = $(collectionEl).is('input');

                var collectionPlaceholder = '';
                if (isSelect) {
                    collectionPlaceholder = $(collectionEl).find("option:selected").text();
                    if ($(collectionEl).val() === '') {
                        $('#collection').addClass('placeholder');
                        collectionPlaceholder = $('#collection').attr('title');
                    } else {
                        $('#collection').removeClass('placeholder');
                    }
                }
                if (isInput) {
                    collectionPlaceholder = $(collectionEl).attr('data-chosen-label');
                }

                $('#collection').text(collectionPlaceholder).show();
                $(collectionEl).hide();
                self.validate_element(collectionEl, $(collectionEl).val());
            } else if ('test_item_row' === row_id) {
                var value = $('#test_item_select').val();
                /*
                if (0 === $('#test_item_select').prop('selectedIndex')) {
                    $('#test_item').addClass('placeholder');
                    value = 'Is this a test item?';
                    self.validate_element($('#test_item')[0], '');

                } else {
                    $('#test_item').removeClass('placeholder');
                    self.validate_element($('#test_item')[0], value);
                }
                */
                $('#test_item').text(value).show();
                $('#test_item_select').hide();
            } else if ('language_row' === row_id) {
                var value = $('#language_select').val();
                self.validate_element($('#language')[0], value);
                if ('' === value) {
                    $('#language').addClass('placeholder');
                    value = $('#language').attr('title');
                } else {
                    $('#language').removeClass('placeholder');
                    value = $("#language_select option:selected").text();
                }
                $('#language').text(value).show();
                $('#language_select').hide();
            } else if ('license_picker_row' === row_id) {
                $('#license_picker').hide();
                if ("No license selected" !== $('#license_text').text()) {
                    $('#license_text').removeClass('placeholder');
                }
            } else if ('more_options_row' === row_id) {
                //nothing to do
            } else {
                var value_span = row.find('.edit_text');
                var input_element = row.find('.input_field');
                var new_value = input_element.val();
                self.validate_element(value_span[0], new_value);
                if ("" == new_value) {
                    new_value = value_span.attr('title');
                    value_span.addClass('placeholder');
                } else {
                    value_span.removeClass('placeholder');
                }
                value_span.text(new_value);
                value_span.show();
                input_element.remove();
            }
        });
        selected_rows.removeClass('selected');
    }


    // remove_overlay()
    //____________________________________________________________________________________
    ia_uploader.remove_overlay = function() {
        $('#overlay').remove();
        $('#overlay_alert').remove();
        $('#upload_button').attr('disabled', false);
    }


    // set_total_bytes()
    //____________________________________________________________________________________
    ia_uploader.set_total_bytes = function() {
        var total_bytes = 0;

        $.each(this.files_array, function(index, file) {
            total_bytes += file.size;
        });

        this.total_bytes = total_bytes;
    }


    // overlay_alert()
    //____________________________________________________________________________________
    ia_uploader.overlay_alert = function(msg, desc) {
        $('body').append('<div id="overlay_alert"><div class="alert_msg">'+msg+'</div><div class="alert_desc">'+desc+'</div><button class="blue_button font14" onclick="IA_UPLOADER.remove_overlay();">Back</button></div>');
        var left = ($(window).width() - $('#overlay_alert').outerWidth()) * 0.5;
        var t = ($(window).height() - $('#overlay_alert').outerHeight()) * 0.5; //top is a global
        $('#overlay_alert').css({top: t, left: left});
    }


    // overlay_progress()
    //____________________________________________________________________________________
    ia_uploader.overlay_progress = function() {
        $('body').append('<div id="overlay_alert"><div id="progress_msg">Please wait while your page is being created</div><div id="progress_bar"></div><div id="progress_file"><span id="progress_file_span"></span><span id="progress_size"><span id="progress_file_size">0</span>/<span id="progress_file_total"></span></span></div></div>');
        var left = ($(window).width() - $('#overlay_alert').outerWidth()) * 0.5;
        var t = ($(window).height() - $('#overlay_alert').outerHeight()) * 0.5; //top is a global

        this.set_total_bytes();

        var percent = 100.0 * this.total_sent / this.total_bytes;
        percent = Math.max(percent, 10.0);
        $("#progress_bar").progressbar({ value: percent });
        $('#overlay_alert').css({top: t, left: left});
        $('#progress_file_total').text(this.formatFileSize(this.total_bytes));
    }


    // overlay_finish_msg()
    //____________________________________________________________________________________
    ia_uploader.overlay_finish_msg = function(msg, extra) {
        $('#progress_msg').text(msg);
        $('#progress_bar').remove();
        $('#progress_file').remove();
        $('#overlay_alert').append(extra);

        var left = ($(window).width() - $('#overlay_alert').outerWidth()) * 0.5;
        $('#overlay_alert').css('left', left);
    }


    /**
     * Displays a finishing message for case where we coudln't get extra status info
     * @param {string} identifier - Archive item identifier
     */
    ia_uploader.overlay_finish_no_status_for_identifier = function(identifier) {
      var url = 'https://archive.org/details/' + identifier;
      this.overlay_finish_msg(
        'Upload complete',
        '<button class="blue_button font14" onclick="window.location.href = \'' + url + '\';">Go to your page</button><div>Your files were uploaded, but we were unable to query the server to see if your page was ready. It may take a few minutes for all of your files to appear.</div>'
      );
    }


    // overlay_loading()
    //____________________________________________________________________________________
    ia_uploader.overlay_loading = function() {
        $('body').append('<div id="overlay"></div><div id="overlay_alert"><div id="progress_msg">Please wait while your files are loaded</div><div id="progress_bar"></div></div>');

        $('#progress_bar').html('&nbsp;')
        $('#progress_bar').css('background', 'url(/upload/img/indeterminate_progress.gif) no-repeat center');

        var left = ($(window).width() - $('#overlay_alert').outerWidth()) * 0.5;
        var t = ($(window).height() - $('#overlay_alert').outerHeight()) * 0.5; //top is a global
        $('#overlay_alert').css({top: t, left: left});

    }



    // check_status()
    //____________________________________________________________________________________
    ia_uploader.check_status = function() {
        window.onbeforeunload = null; //it is now safe to leave the page, even if the archive.php task has not yet completed.

        this.countUpload(this.files_array.length, this.total_bytes);

        $('#progress_bar').progressbar('destroy');
        $('#progress_bar').html('&nbsp;')
        $('#progress_bar').css('background', 'url(/upload/img/indeterminate_progress.gif) no-repeat center');

        var self = this;

        var checkStatus = function() {
            //console.log('status timer!');
            $.ajax({
                type: "GET",
                url: '/upload/app/upload_api.php',
                // IE requires random param to defeat cache
                data: { name: 'catalogRows', identifier: self.identifier, random: Math.random() },
                dataType: "json",
                success: function(json) {
                    // Check if have archived
                    var archiving = false;
                    var redrow    = false;
                    if (!json.success) {
                      self.overlay_finish_no_status_for_identifier(self.identifier);
                      return;
                    }
                    for (var i = 0; i < json.rows.length; i++) {
                        if (json.rows[i].cmd == 'archive.php') {
                            archiving = true;
                            if (json.rows[i].wait_admin == '2') {
                                redrow = true;
                            }
                        }
                        //console.log('Task running[' + i + ']: ' + json.rows[i].cmd);
                    }

                    if (redrow) {
                        var error_msg = 'There was an error creating your page';
                        var url = 'https://archive.org/create/';
                        var retry_msg = '<button class="btn btn-default font14" onclick="window.location.href = \''+url+'\';">Click here to try your upload again</button>';
                        if (self.is_admin) {
                            var catalog_url = 'https://catalogd.archive.org/catalog.php?history=1&identifier='+self.identifier;
                            retry_msg += '<div>As an admin, you can view the item <a href="'+catalog_url+'">history</a></div>';
                        }
                        self.overlay_finish_msg(error_msg, retry_msg);
                    } else if (archiving) {
                        //console.log('Still archiving...');
                        $('#progress_msg').text('Please wait while your page is being created');
                        $('#progress_file').text('Finishing upload... please be patient');
                        var left = ($(window).width() - $('#overlay_alert').outerWidth()) * 0.5;
                        $('#overlay_alert').css('left', left);
                        window.setTimeout(checkStatus, 2000); // reschedule ourselves
                    } else {
                        //console.log('No archive.php tasks running');
                        //parent.find('.createItemPreviewLink').hide();
                        var url = 'https://archive.org/details/'+self.identifier;
                        self.overlay_finish_msg('Your item is ready!', '<button class="blue_button font14" onclick="window.location.href = \''+url+'\';">Go to your page</button><div>or wait <span id="redirect_seconds">3</span> seconds for a redirect</div>');

                        var redirect_seconds = 10;
                        var countdown_to_redirect = function() {
                            if (redirect_seconds == 0) {
                                window.location.href = url;
                            } else {
                                $('#redirect_seconds').text(redirect_seconds);
                                redirect_seconds--;
                                window.setTimeout(countdown_to_redirect, 1000);
                            }
                        };
                        countdown_to_redirect();
                    }

                },
                error: function(xhr, status, error) {
                  self.overlay_finish_no_status_for_identifier(self.identifier);
                }
            });
        };

        checkStatus();

    }


    // validate_element()
    //____________________________________________________________________________________
    ia_uploader.validate_element = function(e, val) {
        //console.log('in validate_element');
        //console.log('element ', e);
        //console.log('val:', val);

        var row = $(e).closest('.metadata_row');

        //if ((val === "Click to edit") || (val === "")) {
        if (val === "") {
            row.find('.checkmark').removeClass('check_green').addClass('check_gray');
            if ($(e).hasClass('required')) {
                row.children('.mdata_key').css('color', 'red');
                return false;
            } else {
                //if the element is not required, set the check to gray but return true
                return true;
            }
        } else {
            row.find('.checkmark').removeClass('check_gray').addClass('check_green');
            if ($(e).hasClass('required')) {
                row.children('.mdata_key').css('color', 'black');
            }
            return true;
        }
    }


    // get_future_date_error()
    //____________________________________________________________________________________
    ia_uploader.get_future_date_error = function(year, month, day) {
        var now = new Date();
        //javascript's Date method takes zero-based months but one-based days
        var date = new Date(year, month-1, day);

        if (date > now) {
            return "The date must not be in the future";
        } else {
            return null;
        }
    }

    // get_date_error()
    //____________________________________________________________________________________
    ia_uploader.get_date_error = function() {
        var year = $('#date_year').val();
        if ("" === year) {
            return null; //no date, which is fine
        }

        //check the year
        if (!/^\d{4}$/.test(year)) {
            return "The year must be a four digit number";
        }

        var year_int = parseInt(year, 10);

        //year is ok, check the month
        var month = $('#date_month').val();
        if ("" === month) {
            //got year but no month, which is fine
            return this.get_future_date_error(year_int, 1, 1);
        }

        if (!/^\d{2}$/.test(month)) {
            return "The month must be a two digit number between 01 and 12";
        }

        var month_int = parseInt(month, 10);

        if ((month_int < 1) || (month_int>12)) {
            return "The month must be a two digit number between 01 and 12";
        }

        //month is ok, check the day
        var day = $('#date_day').val();
        if ("" === day) {
            //got year and month, but no day, which is fine
            return this.get_future_date_error(year_int, month_int, 1);
        }

        if (!/^\d{2}$/.test(day)) {
            return "The day must be a two digit number between 01 and 12";
        }

        var day_int = parseInt(day, 10);
        if ((day_int < 1) || (day_int>31)) {
            return "The day must be a two digit number between 01 and 31";
        }

        //all good. ensure date is not in the future
        return this.get_future_date_error(year_int, month_int, day_int);
    }


    // validate_date()
    //____________________________________________________________________________________
    ia_uploader.validate_date = function() {
        var error = this.get_date_error();
        if (null === error) {
            if ("" !== $('#date_year').val()) {
                $('#date_row').find('.checkmark').removeClass('check_gray').addClass('check_green');
            }
            $('#date_row').children('.mdata_key').css('color', 'black');
        } else {
            $('#date_row').find('.checkmark').removeClass('check_green').addClass('check_gray');
            $('#date_row').children('.mdata_key').css('color', 'red');
        }

        return error;
    }

    // validate()
    //____________________________________________________________________________________
    ia_uploader.validate = function(show_overlay) {
        if (undefined === show_overlay) {
            show_overlay = true;
        }

        if ((this.files_array.length === 0) && show_overlay) {
            this.overlay_alert('There are no files to upload', 'Please drag some files into the gray file list area.');
            return false;
        }

        for (var i=0; i<this.files_array.length; i++) {
            if (this.files_array[i].size === 0) {
                var str1 = 'You cannot upload empty files';
                var str2 = 'Please remove zero-byte files from the upload list.';
                //Directories show up as zero-byte files in Firefox
                str2 += ' Please note that directories show up as zero-byte files in Firefox, and directory uploads are only supported in Chrome.';
                this.overlay_alert(str1, str2);
                return false;
            }
        }

        if ('add' === this.mode) {
            //We don't show the metadata editor in add mode, so do not validate these fields
            return true;
        }

        var self = this;
        var ret = true;

        $('#page_title, #description, #subjects, #creator, [name=mediatypecollection], #test_item, #language').each(function(index, element) {
            //console.log('validating ', element);
            var elemValue;
            if ($(element).hasClass('placeholder')) {
                elemValue = '';
            } else if ($(element).is("input") && $(element).hasClass('mediatypecollection')) {
                // special collections input with autocomplete has its own behavior
                // get actual value from attribute = `data-chosen-value`
                elemValue = $(element).attr('data-chosen-value');
            } else if ($(element).is("input") || $(element).is("textarea") || $(element).is("select")) {
                elemValue = $(element).val();
            } else {
                elemValue = $(element).text();
            }

            if (!self.validate_element(element, elemValue)) {
                ret = false;
                //console.log('  setting ret=false');
            }
        });

        if ((false === ret) && show_overlay) {
            self.overlay_alert('Please complete the required fields highlighted in red.', '(it would be even better to complete as many fields as possible)');
            return ret;
        }

        //validate date
        var date_error = this.validate_date(); //returns either an error string or null
        if ((null !== date_error) && show_overlay) {
            this.overlay_alert('Please complete the required fields highlighted in red.', date_error);
            return false;
        }

        //validate identifier
        if (('' == $('#item_id').text()) && show_overlay) {
            //We've come too far to give up who we are...
            this.overlay_alert('We are still checking for an available identifier', 'Please wait for the identifier check to complete before uploading');
            return false;
        }

        //validate identifier length
        if (this.max_id_length > 0) {
            var id_length = $('#item_id').text().length; //this.identifier not set yet since we are not in add mode
            if ((id_length > this.max_id_length) && show_overlay) {
                this.overlay_alert('The Item Identifier is too long.', 'The Item Identifier must be less than ' + this.max_id_length + ' characters');
                $('#page_url_row > .mdata_key').css('color', 'red');
                return false;
            } else {
                $('#page_url_row > .mdata_key').css('color', 'black');
            }
        }

        //validate additional metadata
        $.each($('.additional_meta_key, .additional_meta_value'), function(i, e) {
            var val = $(e).val();
            if (val === "") {
                $(e).css('border-color', 'red');
                ret = false;
            } else {
                $(e).css('border-color', '');
            }
        });

        if ((false === ret) && show_overlay) {
            $('#more_options_text').css('color', 'red');
            self.overlay_alert('Please complete the required fields highlighted in red.', 'Additional metadata keys and values are required.');
            return ret;
        } else {
            $('#more_options_text').css('color', 'black');
        }

        $.each($('.additional_meta_key'), function(i, e) {
            var val = $(e).val();
            if (!/^[a-z][a-z\d_-]*$/.test(val)) {
                $(e).css('border-color', 'red');
                ret = false;
            } else {
                $(e).css('border-color', '');
            }
        });

        if ((false === ret) && show_overlay) {
            $('#more_options_text').css('color', 'red');
            self.overlay_alert('Invalid metadata key.', 'Metadata key should start with a letter, and only lowercase letters, digits, hypens, and underscores are allowed.');
            return ret;
        } else {
            $('#more_options_text').css('color', 'black');
        }

        var invalid_keys = ['identifier', 'title', 'description', 'mediatype', 'test_item', 'licenseurl',   //these override metadata
                            'dir', 'prevtask', 'next_cmd', 'tester', //these are from ModifyXML::IGNORED_TAGS
                            'key', 'search', 'currentFieldNum', 'multi',
                            'scribe', 'nre',
                            'admincmd', 'adminuser', 'admintime', 'admincont',
                            'stub_files'
        ];

        $.each($('.additional_meta_key'), function(i, e) {
            var val = $(e).val();
            if (-1 !== $.inArray(val, invalid_keys)) {
                $(e).css('border-color', 'red');
                ret = false;
            } else {
                $(e).css('border-color', '');
            }
        });

        if ((false === ret) && show_overlay) {
            $('#more_options_text').css('color', 'red');
            self.overlay_alert('Invalid metadata key.', 'The metadata key highlighted in red is not allowed.');
            return ret;
        } else {
            $('#more_options_text').css('color', 'black');
        }


        return true;
    }


    // uri_encode()
    //____________________________________________________________________________________
    ia_uploader.uri_encode = function(value) {
        //URI Encode metadata in all browsers to allow unicode.
        //In Safari, we need to do this because Safari drops non-ascii characters
        //In Firefox, we need to do this because when passing utf-8 bytes to setReqeuestHeader,
        //Firefox re-encodes utf-8 bytes as latin-1
        return 'uri(' + encodeURIComponent(value) + ')';
    }


    // add_meta_headers_from_class()
    //____________________________________________________________________________________
    ia_uploader.add_meta_headers_from_class = function(xhr) {
        // Find elements marked as item metadata and pass them to uploader
        var metaPattern = new RegExp(' *x-archive-meta-([^ ]+)');
        var self = this;

        // Find elements marked with class x-archive-meta-*
        $('#metadata').find('[class*=x-archive-meta]').each( function(index, elem) {
            //console.log($(elem).attr('class'), $(elem).text());
            var match = metaPattern.exec($(elem).attr('class'));
            var title = $.trim($(elem).attr('title'));

            if (match != null) {
                var elemValue;
                if ($(elem).is("input") || $(elem).is("textarea") || $(elem).is("select")) {
                    elemValue = $.trim($(elem).val());
                } else {
                    elemValue = $.trim($(elem).text());
                }

                if ((elemValue === 'Click to edit') || (elemValue === '') || (elemValue === title)) {
                    return true; //continue
                }

                var xclass = self.getS3MetaHeader(match[1]);
                xhr.setRequestHeader(xclass, self.uri_encode(elemValue));
            }
        });
    }


    // set_xhr_headers()
    //____________________________________________________________________________________
    ia_uploader.set_xhr_headers = function(xhr, file, number) {
        //getS3MetaHeader() uses the meta_index object to calculate the key index
        //for a particular header. Since headers are set for every file, we need to
        //reset this object for every file.
        this.meta_index = {};

        var self = this;
        xhr.setRequestHeader("Content-Type", "multipart/form-data; charset=UTF-8");

        // Don't trigger derive unless last file
        if (number !== (this.files_array.length - 1)) {
            xhr.setRequestHeader('x-archive-queue-derive', "0");
        }

        // Set interactive priority flag that causes the underlying
        // archive.org catalog task to run faster.
        xhr.setRequestHeader("x-archive-interactive-priority", "1");

        xhr.setRequestHeader("Cache-Control", "no-cache");
        xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
        xhr.setRequestHeader("X-File-Name", self.uri_encode(file.name));
        xhr.setRequestHeader("X-File-Size", file.size);
        xhr.setRequestHeader("x-archive-size-hint", this.total_bytes);

        xhr.setRequestHeader('x-amz-acl','bucket-owner-full-control');
        xhr.setRequestHeader("x-amz-auto-make-bucket", "1"); // Create new item
        xhr.setRequestHeader("authorization", "LOW " + this.s3_access_key + ":" + this.s3_secret_key);

        if ('add' === this.mode) {
            //do not set item metadata in add mode.
            return;
        }

        // Split subject field
        var subject_string = $('#subjects').text();
        var subjects = subject_string.split(',');
        $.each(subjects, function(index, value) {
            value = $.trim(value);
            if (value) {
                xhr.setRequestHeader(self.getS3MetaHeader("subject"), self.uri_encode(value));
            }
        });

        // Handle mediatype and collection
        // value of select is e.g. "audio.adsr"
        var mediatype_collection = $('#collection_row').find('[name=mediatypecollection]');
        var isInput = $(mediatype_collection).is('input');
        var mediatypeIdCombo = isInput ? $(mediatype_collection).attr('data-chosen-value') : $(mediatype_collection).val();
        var splitMediatypeId = mediatypeIdCombo.split(':');
        if (splitMediatypeId.length > 1) {
            // a collection was selected
            xhr.setRequestHeader("x-archive-meta-mediatype", self.uri_encode(splitMediatypeId[0]));
            xhr.setRequestHeader(self.getS3MetaHeader('collection'), self.uri_encode(splitMediatypeId[1]));
        }

        // We are now uri encoding the description on all browsers.
        // Safari: silently drops unicode characters from xhr headers
        // Chrome and Firefox: Throw javascript errors when adding html tags with quoted attributes to xhr headers
        xhr.setRequestHeader(self.getS3MetaHeader('description'), self.uri_encode($('#description').html()));

        this.add_meta_headers_from_class(xhr);

        if ("No" !== $('#test_item').text()) {
            xhr.setRequestHeader(self.getS3MetaHeader('collection'), 'test_collection');
        }

        if (this.license_url !== "") {
            xhr.setRequestHeader(self.getS3MetaHeader('licenseurl'), self.uri_encode(this.license_url));
        }

        //additional key-val pairs, including secondary collections
        $.each($('.additional_meta'), function(index, div) {
            var key = $(div).find('.additional_meta_key').val();
            var val = $(div).find('.additional_meta_value').val();
            xhr.setRequestHeader(self.getS3MetaHeader(key), self.uri_encode(val));
        });

        //version number
        xhr.setRequestHeader(self.getS3MetaHeader('scanner'), self.uri_encode('Internet Archive HTML5 Uploader ' + this.version));

    }


    // add_to_dict()
    //____________________________________________________________________________________
    ia_uploader.add_to_dict = function(meta_dict, key, val) {
        if (key in meta_dict) {
            meta_dict[key].push(val);
        } else {
            meta_dict[key] = [val];
        }
    }


    // show_preset_link()
    //____________________________________________________________________________________
    ia_uploader.show_preset_link = function() {
        var map = {'subjects':    'subject',
                   'description': 'description',
                   'creator':     'creator',
                   'date_text':   'date'
        };

        var meta_dict = {};
        var self = this;

        $('#subjects, #description, #creator, #date_text').each(function(index, element) {
            var str = $(element).text();
            if (!$(element).hasClass('placeholder') && ('' != str)) {
                self.add_to_dict(meta_dict, map[element.id], str);
            }
        });

        var mediatype_collection = $('#collection_row').find('[name=mediatypecollection]');
        var isInput = $(mediatype_collection).is('input');
        var mediatypeIdCombo = isInput ? $(mediatype_collection).attr('data-chosen-value') : $(mediatype_collection).val();
        var splitMediatypeId = mediatypeIdCombo.split(':');
        if (splitMediatypeId.length > 1) {
            this.add_to_dict(meta_dict, 'collection', splitMediatypeId[1]);
        }

        if ($('#test_item_select').prop('selectedIndex') === 1) {
            this.add_to_dict(meta_dict, 'test_item', '1');
        }

        var lang = $('#language_select').val();
        if ('' !== lang) {
            this.add_to_dict(meta_dict, 'language', lang);
        }

        if (this.license_url !== "") {
            this.add_to_dict(meta_dict, 'licenseurl', this.license_url);
        }

        $.each($('.additional_meta'), function(index, div) {
            var key = $(div).find('.additional_meta_key').val();
            var val = $(div).find('.additional_meta_value').val();
            self.add_to_dict(meta_dict, key, val);
        });

        var i = 0;
        var url = 'http://archive.org/upload/';
        $.each(meta_dict, function(key, vals) {
            if (1 == vals.length) {
                url += ((0==i)? '?' : '&');
                url += key+'='+encodeURIComponent(vals[0]);
                i++;
            } else {
                vals.map(function(val) {
                    url += ((0==i)? '?' : '&');
                    url += key+'[]='+encodeURIComponent(val);
                    i++;
                });
            }
        });

        url = '<textarea class="preset_textarea">'+url+'</textarea>';
        this.overlay_alert('Use the link below to upload a new item using the same metadata', url);
    }


    // show_resume_msg()
    //____________________________________________________________________________________
    ia_uploader.show_resume_msg = function(xhr) {
        $('#progress_msg').text('There is a network problem');
        $('#progress_bar').progressbar('destroy');
        $('#progress_bar').remove();
        $('#progress_file').remove();

        $('#overlay_alert').append('<button class="blue_button font14" onclick="IA_UPLOADER.resume();">Resume Uploading</button>');

        //TODO: use a template
        if (xhr.status !== 0) {
            var error_code   = $('<span id="upload_error_code"></span>').text(xhr.status);
            var error_status = $('<span id="upload_error_status"></span>').text(xhr.statusText);
            var error_show   = $('<span><a id="upload_error_show_details" href="javascript:$(\'#upload_error_details\').toggle(); IA_UPLOADER.recenter_alert();">(details)</a></span>')
            var error_text   = $('<div id="upload_error_text"></div>').append(error_code).append(error_status).append(error_show);

            //from https://stackoverflow.com/questions/18749591/encode-html-entities-in-javascript/18750001#18750001
            var encoded_string = xhr.responseText.replace(/[\u00A0-\u9999<>\&]/gim, function(i) {
               return '&#'+i.charCodeAt(0)+';';
            });
            var error_details = $('<div id="upload_error_details"></div>').append($('<pre>').append(encoded_string));
            var error_box = $('<div id="upload_error"></div>').append(error_text).append(error_details);

            $('#overlay_alert').append(error_box);
        }

        this.recenter_alert();
    }


    // recenter_alert()
    //____________________________________________________________________________________
    ia_uploader.recenter_alert = function() {
        var left = ($(window).width() - $('#overlay_alert').outerWidth()) * 0.5;
        var t = ($(window).height() - $('#overlay_alert').outerHeight()) * 0.5; //top is a global
        $('#overlay_alert').css({top: t, left: left});
    }


    // resume()
    //____________________________________________________________________________________
    ia_uploader.resume = function() {
        $("#overlay_alert").remove();
        this.overlay_progress();
        this.upload_file(this.current_file);
    }


    // upload_file()
    //____________________________________________________________________________________
    ia_uploader.upload_file = function(number) {
        if (number === this.files_array.length) {
            //console.log('uploaded all files');
            this.check_status();
            return;
        }

        //console.log(number);
        //console.log(this);
        var file = this.files_array[number];
        //console.log(file);
        $('#progress_file_span').text(file.name);

        var xhr = this.xhr;
        var self = this;

        var url;
        if (file.s3path !== undefined) {
            url = this.s3_base_url + this.identifier + encodeURIComponent(file.s3path);
        } else {
            url = this.s3_base_url + this.identifier + '/' + encodeURIComponent(file.name);
        }
        xhr.open('PUT', url, true);

        this.set_xhr_headers(xhr, file, number);

        //console.log(xhr);
        xhr.send(file);
    }


    // upload()
    //____________________________________________________________________________________
    ia_uploader.upload = function() {
        //console.log('starting upload');
        $('#upload_button').attr('disabled', true);
        $('body').append("<div id='overlay'></div>");

        //if editing a row, save the edit before continuing
        this.save_value($('.metadata_row.selected'));

        if (!this.validate()) {
            return;
        }

        //console.log('validation passed');

        if ('add' !== this.mode) {
            //identifier is already set in add mode.
            this.identifier = $('#item_id').text();
        }

        this.overlay_progress();

        var self = this;
        this.xhr.upload['onprogress'] = function(rpe) {
            //console.log('onprogress ');
            //console.log(self);
            var percent = 100.0 * (self.total_sent+rpe.loaded) / self.total_bytes;
            percent = Math.max(percent, 10.0);
            //console.log('percent ');
            //console.log(percent);
            $( "#progress_bar" ).progressbar( "option", "value", percent );
            $('#progress_file_size').text(self.formatFileSize(self.total_sent+rpe.loaded));
        };

        this.xhr.onload = function(load) {
            //console.log('onload');
            //console.log(self);
            //console.log(self.xhr.status);
            var file = self.files_array[self.current_file];
            //console.log(file);
            self.total_sent += file.size;
            var percent = 100.0 * self.total_sent / self.total_bytes;
            percent = Math.max(percent, 10.0);
            //console.log('percent ');
            //console.log(percent);
            $( "#progress_bar" ).progressbar( "option", "value", percent );
            $('#progress_file_size').text(self.formatFileSize(self.total_sent));

            if (self.xhr.status != 200) {
                console.log('onload received error status');
                console.log(self.xhr.status);
                self.show_resume_msg(self.xhr);
            } else {
                self.current_file += 1;
                self.upload_file(self.current_file);
            }
        };

        this.xhr.onerror = function(event) {
            console.log('error');
            console.log(event);
            console.log(self.xhr);
            self.show_resume_msg(self.xhr);
        };

        this.xhr.onabort = function(event) {
            console.log('abort');
            console.log(event);
            console.log(self.xhr);
            self.show_resume_msg(self.xhr);
        }

        if (0 == this.current_file) {
            this.upload_start_time = new Date().getTime();
            //start analytics
            var values = {
                'uploader': 1,
                'start': 1,
                'id': this.identifier,
                'files': this.files_array.length,
                'bytes': this.total_bytes,
                'referrer': 'https://archive.org/upload'
            };
            if (typeof(archive_analytics) != 'undefined') {
                archive_analytics.send_ping(values);
            }
        }

        this.upload_file(this.current_file);

    }

    return ia_uploader;

}(jQuery));
