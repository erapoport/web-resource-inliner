"use strict";

var path = require( "path" );
var unescape = require( "lodash.unescape" );
var xtend = require( "xtend" );
var parallel = require( "async" ).parallel;
var inline = require( "./util" );
var css = require( "./css" );
var htmlparser = require( "htmlparser2" );

module.exports = function( options, callback )
{
    var settings = xtend( {}, inline.defaults, options );

    function replaceInlineAttribute( string )
    {
        return string
            .replace( new RegExp( " " + settings.inlineAttribute + "-ignore" + inline.attrValueExpression, "gi" ), "" )
            .replace( new RegExp( " " + settings.inlineAttribute + inline.attrValueExpression, "gi" ), "" );
    }

    var replaceScript = function( callback )
    {
        var args = this;

        args.element = replaceInlineAttribute( args.element );

        inline.getTextReplacement( args.src, settings, function( err, content )
        {
            if( err )
            {
                return inline.handleReplaceErr( err, args.src, settings.strict, callback );
            }

            var onTransform = function( err, content )
            {
                if( err )
                {
                    return callback( err );
                }

                if( !content || typeof( args.limit ) === "number" && content.length > args.limit * 1000 )
                {
                    return callback( null );
                }
                var html = content.toString();
                html = html.replace( /<\/script>/gmi, "<\\/script>" );
                html = "<script" + ( args.attrs ? " " + args.attrs : "" ) + ">\n" + html + "\n</script>";
                var re = new RegExp( inline.escapeSpecialChars( args.element ), "g" );
                result = result.replace( re, () => html );
                return callback( null );
            };

            if( options.scriptTransform )
            {
                return options.scriptTransform( content, onTransform );
            }
            onTransform( null, content );
        } );
    };

    var replaceLink = function( callback )
    {
        var args = this;

        args.element = replaceInlineAttribute( args.element );
        var re = new RegExp( inline.escapeSpecialChars( args.element ), "g" );
        
        if (typeof(settings.beforeStylesheet) === 'function') {
            var beforeResult = settings.beforeStylesheet(args.src, args.element);
            if (typeof(beforeResult) === 'string') {
                result = result.replace(re, () => beforeResult);
                return callback(null);
            } else if (beforeResult === false) {
                return callback(null);
            }
        }

        inline.getTextReplacement( args.src, settings, function( err, content )
        {
            if( err )
            {
                return inline.handleReplaceErr( err, args.src, settings.strict, callback );
            }

            var onTransform = function( err, content )
            {
                if( err )
                {
                    return callback( err );
                }

                if( !content || typeof( args.limit ) === "number" && content.length > args.limit * 1000 )
                {
                    return callback( null );
                }
                
                var cssOptions = xtend( {}, settings, {
                    fileContent: content.toString(),
                    rebaseRelativeTo: path.relative( settings.relativeTo, settings.rebaseRelativeTo || path.join( settings.relativeTo, args.src, ".." + path.sep ) )
                } );

                css( cssOptions, function( err, content )
                {
                    if( err )
                    {
                        return callback( err );
                    }
                    var html = content.toString();
                    html = html.replace( /<\/script>/gmi, "<\\/script>" );
                    html = "<style" + ( args.attrs ? " " + args.attrs : "" ) + ">\n" + html.replace( /\/\*[\s]*--[\s]*>*/gm, "/* - ->" ) + "\n</style>";
                    result = result.replace( re, () => html );
                    
                    if (typeof(settings.afterStylesheet) === 'function') {
                        settings.afterStylesheet(args.src, args.element, html);
                    }
                    return callback( null );
                } );
            };

            if( options.linkTransform )
            {
                return options.linkTransform( content, onTransform );
            }
            onTransform( null, content );
        } );
    };

    var replaceImg = function( callback )
    {
        var args = this;

        args.element = replaceInlineAttribute( args.element );

        inline.getFileReplacement( args.src, settings, function( err, datauriContent )
        {
            if( err )
            {
                return inline.handleReplaceErr( err, args.src, settings.strict, callback );
            }
            if( !datauriContent || typeof( args.limit ) === "number" && datauriContent.length > args.limit * 1000 )
            {
                return callback( null );
            }
            var html = "<img" + ( args.attrs ? " " + args.attrs : "" ) + " src=\"" + datauriContent + "\" />";
            var re = new RegExp( inline.escapeSpecialChars( args.element ), "g" );
            result = result.replace( re, () => html );
            return callback( null );
        } );
    };

    var replaceSvg = function( callback )
    {
        var args = this;

        args.element = replaceInlineAttribute( args.element );

        inline.getTextReplacement( args.src, settings, function( err, content )
        {
            if( err )
            {
                return inline.handleReplaceErr( err, args.src, settings.strict, callback );
            }
            if( !content || typeof( args.limit ) === "number" && content.length > args.limit * 1000 )
            {
                return callback( null );
            }

            var handler = new htmlparser.DomHandler( function( err, dom )
            {
                if( err )
                {
                    return callback( err );
                }

                var svg = htmlparser.DomUtils.getElements( { id: args.id }, dom );
                if( svg.length )
                {
                    var use = htmlparser.DomUtils.getInnerHTML( svg[ 0 ] );
                    var re = new RegExp( inline.escapeSpecialChars( args.element ), "g" );
                    result = result.replace( re, () => use );
                }

                return callback( null );
            },{ normalizeWhitespace: true } );
            var parser = new htmlparser.Parser( handler, { xmlMode: true } );
            parser.write( content );
            parser.done();
        } );
    };

    var result = settings.fileContent;
    var tasks = [];
    var found;

    var inlineAttributeRegex = new RegExp( settings.inlineAttribute, "i" );
    var inlineAttributeIgnoreRegex = new RegExp( settings.inlineAttribute + "-ignore", "i" );
    var relStylesheetAttributeIgnoreRegex = new RegExp( "stylesheet", "i" );

    var scriptRegex = /<script\b[^>]+?\bsrc\s*=\s*("|')([\s\S]+?)\1[\s\S]*?>[\s\w\S]*?(?=<\/script>)<\/script>/gi;
    while( ( found = scriptRegex.exec( result ) ) !== null )
    {
        if( !inlineAttributeIgnoreRegex.test( found[ 0 ] ) &&
            ( settings.scripts || inlineAttributeRegex.test( found[ 0 ] ) ) )
        {
            var src = unescape( found[ 2 ] ).trim();
            if ( src && src.indexOf( "#" ) !== 0 )
            {
                tasks.push( replaceScript.bind(
                {
                    element: found[ 0 ],
                    src: src,
                    attrs: inline.getAttrs( found[ 0 ], settings ),
                    limit: settings.scripts
                } ) );
            }
        }
    }

    var linkRegex = /<link\b[\s\S]+?\bhref\s*=\s*("|')([\s\S]*?)\1[\s\S]*?>/gm;
    while( ( found = linkRegex.exec( result ) ) !== null )
    {
        if( !inlineAttributeIgnoreRegex.test( found[ 0 ] ) &&
            relStylesheetAttributeIgnoreRegex.test( found[ 0 ] ) &&
            ( settings.links || inlineAttributeRegex.test( found[ 0 ] ) ) )
        {
            var src = unescape( found[ 2 ] ).trim();
            if ( src && src.indexOf( "#" ) !== 0 )
            {
                tasks.push( replaceLink.bind(
                {
                    element: found[ 0 ],
                    src: src,
                    attrs: inline.getAttrs( found[ 0 ], settings ),
                    limit: settings.links
                } ) );
            }
        }
    }

    var imgRegex = /<img\b[\s\S]+?\bsrc\s*=\s*("|')([\s\S]*?)\1[\s\S]*?>/gm;
    while( ( found = imgRegex.exec( result ) ) !== null )
    {
        if( !inlineAttributeIgnoreRegex.test( found[ 0 ] ) &&
            ( settings.images || inlineAttributeRegex.test( found[ 0 ] ) ) )
        {
            var src = unescape( found[ 2 ] ).trim();
            if ( src && src.indexOf( "#" ) !== 0 ) {
                tasks.push( replaceImg.bind(
                {
                    element: found[ 0 ],
                    src: src,
                    attrs: inline.getAttrs( found[ 0 ], settings ),
                    limit: settings.images
                } ) );
            }
        }
    }

    var svgRegex = /<use\b[\s\S]+?\bxlink:href\s*=\s*("|')([\s\S]+?)#([^"'\s]*)("|')\s*\/?>(<\/\s*use>)?/gi;
    while( ( found = svgRegex.exec( result ) ) !== null )
    {
        if( !inlineAttributeIgnoreRegex.test( found[ 0 ] ) &&
            ( settings.svgs || inlineAttributeRegex.test( found[ 0 ] ) ) )
        {
            tasks.push( replaceSvg.bind(
            {
                element: found[ 0 ],
                src: unescape( found[ 2 ] ).trim(),
                attrs: inline.getAttrs( found[ 0 ], settings ),
                limit: settings.svgs,
                id: unescape( found[ 3 ] ).trim()
            } ) );
        }
    }

    result = replaceInlineAttribute( result );

    parallel( tasks, function( err )
    {
        callback( err, result );
    } );
};
